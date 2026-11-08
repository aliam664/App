use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    sync::{Arc, Condvar, Mutex, OnceLock},
    time::{Duration, Instant},
};
#[derive(Default)]
struct Flags {
    paused: bool,
    cancelled: bool,
    preview: Option<String>,
    approved: bool,
    mode: String,
    done: bool,
}
struct Job {
    state: Mutex<Flags>,
    wake: Condvar,
}
static JOBS: OnceLock<Mutex<BTreeMap<String, Arc<Job>>>> = OnceLock::new();
thread_local! {static CURRENT:RefCell<Option<Arc<Job>>>=const {RefCell::new(None)};}
pub struct Guard(Arc<Job>, std::sync::RwLockReadGuard<'static, ()>);
impl Drop for Guard {
    fn drop(&mut self) {
        if let Ok(mut f) = self.0.state.lock() {
            f.done = true;
            self.0.wake.notify_all();
        }
        CURRENT.with(|c| *c.borrow_mut() = None);
    }
}
pub fn begin(id: &str) -> Result<Guard, String> {
    let lifecycle = crate::lifecycle::operation()?;
    let mut jobs = JOBS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Job lock failed")?;
    if let Some(j) = jobs.get(id) {
        if !j.state.lock().map_err(|_| "Job lock failed")?.done {
            return Err("Package job already active".into());
        }
    }
    jobs.retain(|_, j| j.state.lock().map(|s| !s.done).unwrap_or(false));
    let job = Arc::new(Job {
        state: Mutex::new(Flags::default()),
        wake: Condvar::new(),
    });
    jobs.insert(id.into(), job.clone());
    CURRENT.with(|c| *c.borrow_mut() = Some(job.clone()));
    Ok(Guard(job, lifecycle))
}
pub fn mode(mode: &str) {
    CURRENT.with(|c| {
        if let Some(j) = c.borrow().as_ref() {
            if let Ok(mut f) = j.state.lock() {
                f.mode = mode.into();
            }
        }
    });
}
pub fn checkpoint() -> Result<(), String> {
    CURRENT.with(|c| {
        if let Some(j) = c.borrow().as_ref() {
            let mut f = j.state.lock().map_err(|_| "Job lock failed")?;
            while f.paused && !f.cancelled {
                f = j.wake.wait(f).map_err(|_| "Job lock failed")?;
            }
            if f.cancelled {
                return Err("CANCELLED_BY_USER".into());
            }
        }
        Ok(())
    })
}
pub fn control(id: &str, action: &str, preview: Option<&str>) -> Result<Value, String> {
    let job = JOBS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Job lock failed")?
        .get(id)
        .cloned()
        .ok_or("No active job")?;
    let mut f = job.state.lock().map_err(|_| "Job lock failed")?;
    if f.done {
        return Err("Job already finished".into());
    }
    match action {
        "pause" => {
            if f.mode != "download" {
                return Err("Pause is available during transfer only".into());
            }
            f.paused = true;
        }
        "resume" => f.paused = false,
        "cancel" => f.cancelled = true,
        "approve" => {
            if f.preview.as_deref() != preview || preview.is_none() {
                return Err("Stale installation preview".into());
            }
            f.approved = true;
        }
        _ => return Err("Unknown job action".into()),
    }
    job.wake.notify_all();
    Ok(json!({"paused":f.paused,"cancel_requested":f.cancelled,"mode":f.mode}))
}
pub fn approval(id: &str, emit: impl FnOnce()) -> Result<(), String> {
    CURRENT.with(|c| {
        let borrowed = c.borrow();
        let job = borrowed.as_ref().ok_or("Missing job")?;
        {
            let mut f = job.state.lock().map_err(|_| "Job lock failed")?;
            f.preview = Some(id.into());
            f.approved = false;
            f.mode = "approval".into();
        }
        emit();
        let started = Instant::now();
        let mut f = job.state.lock().map_err(|_| "Job lock failed")?;
        while !f.approved && !f.cancelled {
            let (next, _) = job
                .wake
                .wait_timeout(f, Duration::from_secs(1))
                .map_err(|_| "Job lock failed")?;
            f = next;
            if started.elapsed() > Duration::from_secs(900) {
                f.cancelled = true;
            }
        }
        f.preview = None;
        if f.cancelled {
            return Err("INSTALL_PREVIEW_CANCELLED".into());
        }
        Ok(())
    })
}
/// Propagate one job's cancellation/approval state into bounded transfer workers.
pub fn inherit<F: FnOnce() -> R, R>(task: F) -> impl FnOnce() -> R {
    let job = CURRENT.with(|c| c.borrow().clone());
    move || {
        CURRENT.with(|c| *c.borrow_mut() = job);
        let result = task();
        CURRENT.with(|c| *c.borrow_mut() = None);
        result
    }
}
pub fn active() -> bool {
    JOBS.get_or_init(Default::default)
        .lock()
        .map(|jobs| {
            jobs.values()
                .any(|j| j.state.lock().map(|s| !s.done).unwrap_or(true))
        })
        .unwrap_or(true)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inherited_workers_observe_parent_cancellation() {
        let _guard = begin("parallel-test").unwrap();
        let barrier = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            let worker = scope.spawn(inherit(|| {
                barrier.wait();
                checkpoint()
            }));
            control("parallel-test", "cancel", None).unwrap();
            barrier.wait();
            assert!(worker.join().unwrap().is_err());
        });
    }
    #[test]
    fn approval_bound_to_current_preview_and_cancel() {
        let _guard = begin("test-job").unwrap();
        assert!(control("test-job", "approve", Some("stale")).is_err());
        mode("extract");
        assert!(control("test-job", "pause", None).is_err());
        control("test-job", "cancel", None).unwrap();
        assert!(checkpoint().is_err());
    }
}

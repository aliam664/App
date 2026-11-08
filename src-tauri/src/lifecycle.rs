//! A writer excludes all app-owned mutations while the signed app updater exits.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    RwLock, RwLockReadGuard, RwLockWriteGuard,
};
#[derive(Default)]
pub struct Gate(RwLock<()>, AtomicBool);
impl Gate {
    fn operation(&self) -> Result<RwLockReadGuard<'_, ()>, String> {
        let guard = self
            .0
            .try_read()
            .map_err(|_| "Launcher update is preparing; try again shortly".to_string())?;
        if self.1.load(Ordering::SeqCst) {
            return Err("Launcher is closing; try again after restart".into());
        }
        Ok(guard)
    }
    fn update(&self) -> Result<RwLockWriteGuard<'_, ()>, String> {
        self.0
            .try_write()
            .map_err(|_| "A content operation is still active".into())
    }
}
static GATE: Gate = Gate(RwLock::new(()), AtomicBool::new(false));
pub fn mark_exiting() {
    GATE.1.store(true, Ordering::SeqCst);
}
pub fn resume_after_failed_install() {
    GATE.1.store(false, Ordering::SeqCst);
}
pub fn operation() -> Result<RwLockReadGuard<'static, ()>, String> {
    GATE.operation()
}
pub fn update() -> Result<RwLockWriteGuard<'static, ()>, String> {
    GATE.update()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn active_operations_exclude_update_and_update_excludes_new_operations() {
        let gate = Gate::default();
        let operation = gate.operation().unwrap();
        assert!(gate.update().is_err());
        let second = gate.operation().unwrap();
        drop(operation);
        assert!(gate.update().is_err());
        drop(second);
        let update = gate.update().unwrap();
        assert!(gate.operation().is_err());
        assert!(gate.update().is_err());
        drop(update);
        assert!(gate.operation().is_ok());
        gate.1.store(true, Ordering::SeqCst);
        assert!(gate.operation().is_err());
    }
}

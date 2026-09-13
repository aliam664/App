//! Hardware detection + smart tier suggestion — port of `src/lib/hardware.js`.
//!
//! Reference anchors (user's test results):
//!   Low = GTX 1650, Medium = RX 580, High = GTX 1660 Ti,
//!   VeryHigh = RTX 2060 SUPER, Ultra = RTX 3060 and newer.
//!
//! Rules:
//!  1. Known GPU list is checked first (most specific model wins).
//!  2. Unknown GPUs fall back to VRAM (1-2 GB always Low).
//!  3. RAM is a hard ceiling; 4. CPU is a soft ceiling.
//!  Final tier = min(GPU/VRAM tier, RAM cap, CPU cap).

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Duration;

static GPU_CHECKS: Lazy<Vec<(&'static str, Regex)>> = Lazy::new(|| {
    let mk = |t: &'static str, re: &str| (t, Regex::new(&format!("(?i){re}")).expect("gpu regex"));
    vec![
        mk("ultra", r"\b(rtx\s*(3060(\s*ti)?|3070(\s*ti)?|3080(\s*ti)?|3090(\s*ti)?|4060(\s*ti)?|4070(\s*ti|super|ti\s*super)?|4080(\s*super)?|4090(\s*ti)?|5060(\s*ti)?|5070(\s*ti)?|5080|5090))\b"),
        mk("ultra", r"\brx\s*(6600(\s*xt)?|6650(\s*xt)?|6700(\s*xt)?|6750(\s*xt)?|6800(\s*xt)?|6900(\s*xt)?|6950(\s*xt)?|7600(\s*xt)?|7700(\s*xt)?|7800(\s*xt)?|7900(\s*xt|xtx|gre)?)\b"),
        mk("ultra", r"\b(arc\s*(a750|a770|b570|b580))\b"),
        mk("veryhigh", r"(2060\s*super|2070(\s*super)?|2080(\s*super)?|gtx\s*1080|rtx\s*3050\s*ti)"),
        mk("veryhigh", r"\brx\s*(5700\s*xt|6700\s*xt|6800\s*xt|6900\s*xt)\b"),
        mk("high", r"(1660\s*ti|1660\s*super|2060|3050|2050|gtx\s*1070(\s*ti)?|gtx\s*980\s*ti|gtx\s*780|mx\s*450|mx\s*550)"),
        mk("high", r"\brx\s*(5600(\s*xt)?|5700|vega\s*56)\b|\barc\s*a580\b"),
        mk("medium", r"(1650\s*super|1660|1060(\s*ti)?|gtx\s*970|gtx\s*980|gtx\s*770|gtx\s*760|mx\s*250|mx\s*330|mx\s*350)"),
        mk("medium", r"\brx\s*(460|470|480|570|580|590|5500\s*xt|6500\s*xt|6500)\b|\br9\s*(380|390)\b"),
        mk("low", r"(1650|1050(\s*ti)?|1030|gtx\s*950|gtx\s*960|gtx\s*750(\s*ti)?|gtx\s*740|gtx\s*730|gtx\s*720|gtx\s*710|gt\s*1030|gt\s*710|gtx\s*920|gtx\s*940|mx\s*110|mx\s*130|mx\s*150|mx\s*230)"),
        mk("low", r"\brx\s*(530|540|550|560|560\s*xt)\b|\br7\s*(240|250|260|360|370)\b|\br5\s*340\b|\bhd\s*(6870|6750|6770|7750|7770|7850|7870)\b"),
        mk("low", r"(intel[^0-9]*(uhd|hd|iris)[^0-9]*|intel\s*arc\s*a380|radeon\s*vega\s*(3|6|8|11)|vega\s*(3|8|11)|integrated|nvidia\s*geforce\s*(gt|mx)\s*\d{2,3})"),
    ]
});

const TIER_ORDER: [&str; 5] = ["low", "medium", "high", "veryhigh", "ultra"];

pub fn tier_score(tier: &str) -> u8 {
    TIER_ORDER.iter().position(|t| *t == tier).map(|i| i as u8 + 1).unwrap_or(0)
}

fn cap_to_tier(score: u8) -> &'static str {
    TIER_ORDER[(score.clamp(1, 5) - 1) as usize]
}

pub fn parse_vram_to_gb(raw: &str, unit: &str) -> Option<f64> {
    let num: f64 = raw.replace(',', "").trim().parse().ok()?;
    if !num.is_finite() || num <= 0.0 {
        return None;
    }
    // Win32_VideoController.AdapterRAM reports 0xFFFFFFFF when unknown.
    if num == 4294967295.0 {
        return None;
    }
    let gb = match unit {
        "bytes" => num / (1024.0 * 1024.0 * 1024.0),
        "mib" => num / 1024.0,
        _ => {
            if num > 1_000_000.0 { num / (1024.0 * 1024.0 * 1024.0) } else if num > 1000.0 { num / 1024.0 } else { num }
        }
    };
    Some((gb * 10.0).round() / 10.0)
}

pub fn suggest_tier_from_gpu(name: &str) -> Option<&'static str> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    GPU_CHECKS.iter().find(|(_, re)| re.is_match(name)).map(|(t, _)| *t)
}

pub fn suggest_tier_from_vram(vram_gb: Option<f64>) -> Option<&'static str> {
    let v = vram_gb?;
    if v <= 0.0 { return None; }
    Some(if v <= 2.0 { "low" } else if v <= 4.0 { "medium" } else if v <= 6.0 { "high" } else if v <= 8.0 { "veryhigh" } else { "ultra" })
}

pub fn ram_cap(ram_gb: f64) -> u8 {
    if ram_gb < 4.0 { 1 } else if ram_gb < 8.0 { 2 } else if ram_gb < 16.0 { 4 } else { 5 }
}

pub fn cpu_cap(cores: u32) -> u8 {
    if cores <= 2 { 2 } else if cores <= 4 { 3 } else if cores <= 6 { 4 } else { 5 }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpecsInput {
    #[serde(default)]
    pub gpu_name: Option<String>,
    #[serde(default)]
    pub gpu_vram_gb: Option<f64>,
    #[serde(default)]
    pub cpu_cores: Option<u32>,
    #[serde(default)]
    pub total_mem_gb: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub tier: &'static str,
    pub reason: String,
    pub detected_by: String,
    pub constrained: bool,
}

pub fn suggest_tier_from_specs(s: &SpecsInput) -> Suggestion {
    let gpu = suggest_tier_from_gpu(s.gpu_name.as_deref().unwrap_or(""));
    let (base, mut reason, mut detected_by): (u8, String, String) = match gpu {
        Some(t) => (tier_score(t), t.into(), "gpu".into()),
        None => match suggest_tier_from_vram(s.gpu_vram_gb) {
            Some(t) => (tier_score(t), "vram".into(), "vram".into()),
            None => (2, "unknown".into(), "unknown".into()),
        },
    };
    // A 1-2 GB card is always Low, regardless of model name.
    let base = match s.gpu_vram_gb { Some(v) if v > 0.0 && v <= 2.0 => 1, _ => base };
    let ram = s.total_mem_gb.map(ram_cap).unwrap_or(5);
    let cpu = s.cpu_cores.map(cpu_cap).unwrap_or(5);
    let final_score = base.min(ram).min(cpu);
    let constrained = final_score < base;
    if constrained {
        if ram < base && ram <= cpu {
            reason = "ram-limited".into();
            detected_by = format!("{detected_by}-ram-limited");
        } else {
            reason = "cpu-limited".into();
            detected_by = format!("{detected_by}-cpu-limited");
        }
    }
    Suggestion { tier: cap_to_tier(final_score), reason, detected_by, constrained }
}

/* ------------------------------------------------------------------ */
/*  OS detection                                                       */
/* ------------------------------------------------------------------ */

fn run_cmd(cmd: &str, args: &[&str], timeout: Duration) -> String {
    let mut c = Command::new(cmd);
    c.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let Ok(mut child) = c.spawn() else { return String::new() };
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > timeout => { let _ = child.kill(); return String::new(); }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => return String::new(),
        }
    }
    let mut out = String::new();
    if let Some(mut so) = child.stdout.take() {
        use std::io::Read;
        let _ = so.read_to_string(&mut out);
    }
    out
}

struct Gpu {
    name: String,
    vram_gb: Option<f64>,
    driver: Option<String>,
    source: &'static str,
}

#[cfg(windows)]
fn detect_gpu() -> Option<Gpu> {
    let t = Duration::from_secs(3);
    let nv = run_cmd("nvidia-smi", &["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"], t);
    if !nv.trim().is_empty() {
        let parts: Vec<&str> = nv.trim().lines().next().unwrap_or("").split(',').map(|p| p.trim()).collect();
        if !parts.first().unwrap_or(&"").is_empty() {
            return Some(Gpu { name: parts[0].into(), vram_gb: parts.get(1).and_then(|v| parse_vram_to_gb(v, "mib")), driver: parts.get(2).map(|s| s.to_string()).filter(|s| !s.is_empty()), source: "nvidia-smi" });
        }
    }
    let ps = run_cmd("powershell.exe", &["-NoProfile", "-ErrorAction", "SilentlyContinue", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress"], Duration::from_secs(6));
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(ps.trim()) {
        let name = json.get("Name").or(json.get("name")).and_then(|v| v.as_str()).unwrap_or("");
        if !name.is_empty() {
            let ram = json.get("AdapterRAM").or(json.get("adapterRAM")).map(|v| v.to_string()).unwrap_or_default();
            return Some(Gpu { name: name.into(), vram_gb: parse_vram_to_gb(&ram, "bytes"), driver: json.get("DriverVersion").and_then(|v| v.as_str()).map(|s| s.to_string()), source: "powershell" });
        }
    }
    let wmic = run_cmd("wmic", &["path", "win32_VideoController", "get", "name,AdapterRAM,DriverVersion", "/format:csv"], t);
    let lines: Vec<&str> = wmic.trim().lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() > 1 {
        let parts: Vec<&str> = lines[1].split(',').collect();
        if parts.len() >= 3 {
            let n = parts.len();
            let name = parts[n - 3].trim();
            if !name.is_empty() {
                return Some(Gpu { name: name.into(), vram_gb: parse_vram_to_gb(parts[n - 2], "bytes"), driver: Some(parts[n - 1].trim().to_string()).filter(|s| !s.is_empty()), source: "wmic" });
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn detect_gpu() -> Option<Gpu> {
    let out = run_cmd("lspci", &[], Duration::from_secs(3));
    for line in out.lines() {
        if let Some(idx) = line.find("VGA compatible controller") {
            if let Some(colon) = line[idx..].find(':') {
                let name = line[idx + colon + 1..].trim();
                if !name.is_empty() {
                    return Some(Gpu { name: name.into(), vram_gb: None, driver: None, source: "lspci" });
                }
            }
        }
    }
    None
}

pub fn detect_system_specs() -> serde_json::Value {
    let mut sys = sysinfo::System::new();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
    sys.refresh_memory();
    let cpu_name = sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
    let cpu_cores = sys.cpus().len() as u32;
    let total_mem_gb = ((sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0)) * 10.0).round() / 10.0;
    let platform = if cfg!(windows) { "win32" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" };
    let os_version = sysinfo::System::os_version().unwrap_or_default();

    let gpu = std::panic::catch_unwind(detect_gpu).ok().flatten();
    let (gpu_name, gpu_vram, driver, source) = match gpu {
        Some(g) => (g.name, g.vram_gb, g.driver, Some(g.source)),
        None => (String::new(), None, None, None),
    };
    let suggestion = suggest_tier_from_specs(&SpecsInput { gpu_name: Some(gpu_name.clone()), gpu_vram_gb: gpu_vram, cpu_cores: Some(cpu_cores), total_mem_gb: Some(total_mem_gb) });

    serde_json::json!({
        "platform": platform,
        "osVersion": os_version,
        "cpuName": cpu_name,
        "cpuCores": cpu_cores,
        "totalMemGb": total_mem_gb,
        "gpuName": gpu_name,
        "gpuVramGb": gpu_vram,
        "driverVersion": driver,
        "gpuSource": source,
        "suggestedTier": suggestion.tier,
        "detectedBy": suggestion.detected_by,
        "tierReason": suggestion.reason,
        "constrained": suggestion.constrained,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(gpu: &str, vram: Option<f64>, cores: u32, ram: f64) -> Suggestion {
        suggest_tier_from_specs(&SpecsInput { gpu_name: Some(gpu.into()), gpu_vram_gb: vram, cpu_cores: Some(cores), total_mem_gb: Some(ram) })
    }

    #[test]
    fn anchors() {
        assert_eq!(s("NVIDIA GeForce GTX 1650", Some(4.0), 8, 16.0).tier, "low");
        assert_eq!(s("Radeon RX 580", Some(8.0), 8, 16.0).tier, "medium");
        assert_eq!(s("GeForce GTX 1660 Ti", Some(6.0), 8, 16.0).tier, "high");
        assert_eq!(s("RTX 2060 SUPER", Some(8.0), 8, 16.0).tier, "veryhigh");
        assert_eq!(s("NVIDIA GeForce RTX 3060", Some(12.0), 12, 32.0).tier, "ultra");
        assert_eq!(s("RTX 4070 Ti SUPER", Some(16.0), 16, 32.0).tier, "ultra");
    }

    #[test]
    fn caps_and_fallbacks() {
        let r = s("RTX 3080", Some(10.0), 4, 32.0);
        assert_eq!(r.tier, "high");
        assert!(r.constrained && r.detected_by.ends_with("cpu-limited"));
        let r = s("RTX 3080", Some(10.0), 16, 6.0);
        assert_eq!(r.tier, "medium");
        assert!(r.reason == "ram-limited");
        assert_eq!(s("Unknown GPU XYZ", Some(6.0), 8, 16.0).tier, "high");
        assert_eq!(s("Unknown GPU XYZ", Some(2.0), 8, 16.0).tier, "low");
        assert_eq!(s("Intel(R) UHD Graphics 630", None, 8, 16.0).tier, "low");
        assert_eq!(s("", None, 8, 16.0).detected_by, "unknown");
    }

    #[test]
    fn vram_parsing() {
        assert_eq!(parse_vram_to_gb("8192", "mib"), Some(8.0));
        assert_eq!(parse_vram_to_gb("4294967295", "bytes"), None);
        assert_eq!(parse_vram_to_gb("6442450944", "bytes"), Some(6.0));
        assert_eq!(parse_vram_to_gb("abc", "mib"), None);
    }
}

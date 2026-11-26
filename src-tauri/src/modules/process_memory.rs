//! Best-effort working-set trim for the process that remains in the tray.

/// Trim process working set when possible. Safe no-op on unsupported platforms.
pub fn trim_idle_process_memory() {
    #[cfg(target_os = "windows")]
    {
        windows_trim_working_set();
    }
    #[cfg(target_os = "macos")]
    {
        // No stable public API equivalent to EmptyWorkingSet; leave as no-op.
    }
    #[cfg(target_os = "linux")]
    {
        // Hint only — malloc_trim is glibc-specific and optional.
        // SAFETY: malloc_trim is a best-effort glibc extension.
        #[cfg(target_env = "gnu")]
        unsafe {
            extern "C" {
                fn malloc_trim(pad: usize) -> i32;
            }
            let _ = malloc_trim(0);
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_trim_working_set() {
    use windows::Win32::System::ProcessStatus::EmptyWorkingSet;
    use windows::Win32::System::Threading::GetCurrentProcess;

    // SAFETY: EmptyWorkingSet on current process is a documented best-effort API.
    unsafe {
        let handle = GetCurrentProcess();
        let _ = EmptyWorkingSet(handle);
    }
}

#[cfg(test)]
mod tests {
    use super::trim_idle_process_memory;

    #[test]
    fn trim_idle_process_memory_does_not_panic() {
        trim_idle_process_memory();
    }
}

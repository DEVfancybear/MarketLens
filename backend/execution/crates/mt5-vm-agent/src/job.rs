use std::io;
use std::process::Child;

fn cpu_rate_units(cpu_budget_percent: u32) -> Option<u32> {
    (1..=100)
        .contains(&cpu_budget_percent)
        .then_some(cpu_budget_percent * 100)
}

#[cfg(windows)]
fn windows_call_result(succeeded: i32) -> io::Result<()> {
    if succeeded == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_CPU_RATE_CONTROL_ENABLE,
        JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK, JOBOBJECT_CPU_RATE_CONTROL_INFORMATION,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectCpuRateControlInformation,
        JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
    };

    use super::*;

    #[derive(Debug)]
    pub struct ProcessJob {
        handle: HANDLE,
        active_process_limit: u32,
        process_memory_limit: usize,
        cpu_rate: u32,
    }

    // Windows kernel handles are valid across threads. ProcessJob owns the
    // handle uniquely and closes it exactly once, so moving the unopened
    // per-slot driver into its dedicated actor thread preserves ownership.
    unsafe impl Send for ProcessJob {}

    impl ProcessJob {
        pub fn new(
            active_process_limit: u32,
            process_memory_limit: usize,
            cpu_budget_percent: u32,
        ) -> io::Result<Self> {
            let Some(cpu_rate) = cpu_rate_units(cpu_budget_percent) else {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "CPU budget must be between 1 and 100 percent",
                ));
            };
            if active_process_limit == 0 || process_memory_limit == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "job limits must be non-zero",
                ));
            }
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = Self {
                handle,
                active_process_limit,
                process_memory_limit,
                cpu_rate,
            };
            if let Err(error) = job.configure(false) {
                unsafe { CloseHandle(handle) };
                return Err(error);
            }
            Ok(job)
        }

        pub fn assign(&self, child: &Child) -> io::Result<()> {
            let assigned =
                unsafe { AssignProcessToJobObject(self.handle, child.as_raw_handle() as HANDLE) };
            if assigned == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        pub fn terminate(&self, exit_code: u32) -> io::Result<()> {
            let terminated = unsafe { TerminateJobObject(self.handle, exit_code) };
            if terminated == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        pub fn assign_pid(&self, pid: u32) -> io::Result<()> {
            use windows_sys::Win32::System::Threading::{
                OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
            };

            let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
            if process.is_null() {
                return Err(io::Error::last_os_error());
            }
            let assigned = unsafe { AssignProcessToJobObject(self.handle, process) };
            unsafe { CloseHandle(process) };
            if assigned == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        pub fn seal_child_processes(&self) -> io::Result<()> {
            self.configure(false)
        }

        fn configure(&self, allow_silent_breakaway: bool) -> io::Result<()> {
            let mut information: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
            information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
                | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            if allow_silent_breakaway {
                information.BasicLimitInformation.LimitFlags |=
                    JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
            }
            information.BasicLimitInformation.ActiveProcessLimit = self.active_process_limit;
            information.ProcessMemoryLimit = self.process_memory_limit;
            let configured = unsafe {
                SetInformationJobObject(
                    self.handle,
                    JobObjectExtendedLimitInformation,
                    (&raw const information).cast::<c_void>(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            windows_call_result(configured)?;
            let mut cpu_information: JOBOBJECT_CPU_RATE_CONTROL_INFORMATION = unsafe { zeroed() };
            cpu_information.ControlFlags =
                JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
            cpu_information.Anonymous.CpuRate = self.cpu_rate;
            let cpu_configured = unsafe {
                SetInformationJobObject(
                    self.handle,
                    JobObjectCpuRateControlInformation,
                    (&raw const cpu_information).cast::<c_void>(),
                    size_of::<JOBOBJECT_CPU_RATE_CONTROL_INFORMATION>() as u32,
                )
            };
            windows_call_result(cpu_configured)
        }
    }

    impl Drop for ProcessJob {
        fn drop(&mut self) {
            if !self.handle.is_null() {
                unsafe { CloseHandle(self.handle) };
                self.handle = std::ptr::null_mut();
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    #[derive(Debug)]
    pub struct ProcessJob;

    impl ProcessJob {
        pub fn new(
            active_process_limit: u32,
            process_memory_limit: usize,
            cpu_budget_percent: u32,
        ) -> io::Result<Self> {
            if active_process_limit == 0
                || process_memory_limit == 0
                || cpu_rate_units(cpu_budget_percent).is_none()
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "job limits must be non-zero",
                ));
            }
            Ok(Self)
        }

        pub fn assign(&self, _child: &Child) -> io::Result<()> {
            Ok(())
        }

        pub fn terminate(&self, _exit_code: u32) -> io::Result<()> {
            Ok(())
        }

        pub fn assign_pid(&self, _pid: u32) -> io::Result<()> {
            Ok(())
        }

        pub fn seal_child_processes(&self) -> io::Result<()> {
            Ok(())
        }
    }
}

pub use platform::ProcessJob;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_budget_maps_to_windows_hundredth_percent_units() {
        assert_eq!(cpu_rate_units(1), Some(100));
        assert_eq!(cpu_rate_units(25), Some(2_500));
        assert_eq!(cpu_rate_units(100), Some(10_000));
        assert_eq!(cpu_rate_units(0), None);
        assert_eq!(cpu_rate_units(101), None);
    }

    #[test]
    fn process_job_rejects_an_invalid_cpu_budget() {
        assert!(ProcessJob::new(1, 1, 0).is_err());
        assert!(ProcessJob::new(1, 1, 101).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_call_results_fail_closed() {
        assert!(windows_call_result(0).is_err());
        assert!(windows_call_result(1).is_ok());
    }
}

use std::io;
use std::process::Child;

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
    };

    use super::*;

    #[derive(Debug)]
    pub struct ProcessJob {
        handle: HANDLE,
        active_process_limit: u32,
        process_memory_limit: usize,
    }

    impl ProcessJob {
        pub fn new(active_process_limit: u32, process_memory_limit: usize) -> io::Result<Self> {
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
            if configured == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
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
        pub fn new(active_process_limit: u32, process_memory_limit: usize) -> io::Result<Self> {
            if active_process_limit == 0 || process_memory_limit == 0 {
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

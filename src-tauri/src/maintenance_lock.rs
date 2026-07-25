use std::sync::atomic::{AtomicU8, Ordering};

const STATE_IDLE: u8 = 0;
const STATE_SIYUAN_IMPORT: u8 = 1;
const STATE_APP_MAINTENANCE: u8 = 2;

static MAINTENANCE_STATE: AtomicU8 = AtomicU8::new(STATE_IDLE);

pub struct MaintenanceGuard {
    state: u8,
}

impl MaintenanceGuard {
    pub fn acquire_siyuan_import() -> Result<Self, String> {
        Self::acquire(
            STATE_SIYUAN_IMPORT,
            "A SiYuan import is already in progress",
        )
    }

    pub fn acquire_app_maintenance() -> Result<Self, String> {
        Self::acquire(
            STATE_APP_MAINTENANCE,
            "App backup or restore is already in progress",
        )
    }

    fn acquire(desired: u8, same_kind_error: &str) -> Result<Self, String> {
        match MAINTENANCE_STATE.compare_exchange(
            STATE_IDLE,
            desired,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => Ok(Self { state: desired }),
            Err(STATE_SIYUAN_IMPORT) => Err(if desired == STATE_SIYUAN_IMPORT {
                same_kind_error.to_string()
            } else {
                "Cannot run app backup or restore while a SiYuan import is in progress".to_string()
            }),
            Err(STATE_APP_MAINTENANCE) => Err(if desired == STATE_APP_MAINTENANCE {
                same_kind_error.to_string()
            } else {
                "Cannot import SiYuan data while app backup or restore is in progress".to_string()
            }),
            Err(_) => Err("App maintenance is already in progress".to_string()),
        }
    }
}

impl Drop for MaintenanceGuard {
    fn drop(&mut self) {
        let _ = MAINTENANCE_STATE.compare_exchange(
            self.state,
            STATE_IDLE,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_siyuan_import_count() -> usize {
        if MAINTENANCE_STATE.load(Ordering::SeqCst) == STATE_SIYUAN_IMPORT {
            1
        } else {
            0
        }
    }

    #[test]
    fn maintenance_guard_serializes_conflicting_operations_and_releases() {
        MAINTENANCE_STATE.store(STATE_IDLE, Ordering::SeqCst);

        let import = MaintenanceGuard::acquire_siyuan_import().expect("import lock");
        assert_eq!(active_siyuan_import_count(), 1);
        assert!(MaintenanceGuard::acquire_app_maintenance().is_err());
        drop(import);
        assert_eq!(active_siyuan_import_count(), 0);

        let backup = MaintenanceGuard::acquire_app_maintenance().expect("backup lock");
        assert!(MaintenanceGuard::acquire_siyuan_import().is_err());
        drop(backup);

        MAINTENANCE_STATE.store(STATE_IDLE, Ordering::SeqCst);
    }
}

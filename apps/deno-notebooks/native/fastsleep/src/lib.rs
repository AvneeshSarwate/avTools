use spin_sleep::{SpinSleeper, SpinStrategy};
use std::sync::OnceLock;
use std::time::Duration;

static SLEEPER: OnceLock<SpinSleeper> = OnceLock::new();

fn sleeper() -> &'static SpinSleeper {
    // Default tuned for “good enough” short sleeps:
    // - 200µs native accuracy (thread::sleep bulk, spin tail)
    // - per-OS default spin strategy (YieldThread on non-Windows, SpinLoopHint on Windows)
    // See spin_sleep docs for details. (You can override via fast_sleep_init.)
    SLEEPER.get_or_init(|| {
        SpinSleeper::new(200_000).with_spin_strategy(SpinStrategy::default())
    })
}

/// Optional: configure the global sleeper ONCE, before calling fast_sleep_us.
///
/// native_accuracy_us:
///   How much "inaccuracy" to assume for native thread::sleep. Bigger => less spinning (less CPU), often more jitter.
/// strategy:
///   0 = per-OS default
///   1 = YieldThread
///   2 = SpinLoopHint
///
/// Returns:
///   0 = ok
///   1 = already initialized
///  -1 = invalid strategy
#[no_mangle]
pub extern "C" fn fast_sleep_init(native_accuracy_us: u32, strategy: u32) -> i32 {
    let strat = match strategy {
        0 => SpinStrategy::default(),
        1 => SpinStrategy::YieldThread,
        2 => SpinStrategy::SpinLoopHint,
        _ => return -1,
    };

    let acc_ns_u64 = (native_accuracy_us as u64).saturating_mul(1_000);
    let acc_ns_u32 = acc_ns_u64.min(u32::MAX as u64) as u32;

    let s = SpinSleeper::new(acc_ns_u32).with_spin_strategy(strat);

    match SLEEPER.set(s) {
        Ok(_) => 0,
        Err(_) => 1,
    }
}

/// Sleep for `us` microseconds using spin_sleep.
/// Intended to be called from Deno via FFI with `nonblocking: true`.
#[no_mangle]
pub extern "C" fn fast_sleep_us(us: u32) {
    sleeper().sleep(Duration::from_micros(us as u64));
}

//! Hand computer keys to Ableton so Live's own keyboard writes the clip.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AttachThreadInput, BringWindowToTop, EnumWindows, GetAncestor, GetForegroundWindow, GetWindow,
    GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, SetFocus, SetForegroundWindow,
    GA_ROOTOWNER, GW_OWNER,
};

static PLUGIN: AtomicIsize = AtomicIsize::new(0);
static KEYS_LIVE: AtomicBool = AtomicBool::new(true);

pub fn set_plugin_hwnd(hwnd: isize) {
    if hwnd != 0 {
        PLUGIN.store(hwnd, Ordering::Relaxed);
    }
}

pub fn set_keys_live(on: bool) {
    KEYS_LIVE.store(on, Ordering::Relaxed);
}

pub fn keys_live() -> bool {
    KEYS_LIVE.load(Ordering::Relaxed)
}

pub fn yield_to_live() {
    if !KEYS_LIVE.load(Ordering::Relaxed) {
        return;
    }
    let Some(target) = live_hwnd() else {
        return;
    };
    unsafe {
        let plugin = PLUGIN.load(Ordering::Relaxed);
        let hwnd = HWND(plugin);
        let mut plugin_pid = 0u32;
        let mut live_pid = 0u32;
        let plugin_tid = if plugin != 0 {
            GetWindowThreadProcessId(hwnd, Some(&mut plugin_pid))
        } else {
            0
        };
        let live_tid = GetWindowThreadProcessId(target, Some(&mut live_pid));
        if plugin_tid != 0 && plugin_tid != live_tid {
            let _ = AttachThreadInput(plugin_tid, live_tid, TRUE);
            steal_focus(target);
            let _ = AttachThreadInput(plugin_tid, live_tid, FALSE);
        } else {
            steal_focus(target);
        }
    }
}

pub fn tap(key: &str, down: bool) {
    if !KEYS_LIVE.load(Ordering::Relaxed) {
        return;
    }
    yield_to_live();
    let Some(vk) = vk_for(key) else {
        return;
    };
    unsafe {
        let flags = if down {
            KEYBD_EVENT_FLAGS(0)
        } else {
            KEYEVENTF_KEYUP
        };
        let input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

fn steal_focus(target: HWND) {
    unsafe {
        let _ = BringWindowToTop(target);
        let _ = SetForegroundWindow(target);
        let _ = SetFocus(target);
    }
}

fn live_hwnd() -> Option<HWND> {
    let plugin = PLUGIN.load(Ordering::Relaxed);
    unsafe {
        if plugin != 0 {
            let hwnd = HWND(plugin);
            let owner = GetWindow(hwnd, GW_OWNER);
            let root = GetAncestor(hwnd, GA_ROOTOWNER);
            let candidate = if owner.0 != 0 && owner.0 != plugin {
                owner
            } else if root.0 != 0 && root.0 != plugin {
                root
            } else {
                HWND(0)
            };
            if candidate.0 != 0 && candidate.0 != plugin && looks_like_live(candidate) {
                return Some(candidate);
            }
        }
        let found = find_live();
        if found.0 != 0 && found.0 != plugin {
            Some(found)
        } else {
            let fg = GetForegroundWindow();
            if fg.0 != 0 && fg.0 != plugin && looks_like_live(fg) {
                Some(fg)
            } else {
                None
            }
        }
    }
}

fn looks_like_live(hwnd: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return false;
        }
        let mut buf = [0u16; 192];
        let n = GetWindowTextW(hwnd, &mut buf);
        if n <= 0 {
            return false;
        }
        let title = String::from_utf16_lossy(&buf[..n as usize]);
        title.contains("Ableton Live")
    }
}

unsafe fn find_live() -> HWND {
    let mut found = HWND(0);
    let _ = EnumWindows(Some(enum_live), LPARAM(&mut found as *mut HWND as isize));
    found
}

unsafe extern "system" fn enum_live(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if !looks_like_live(hwnd) {
        return TRUE;
    }
    let slot = lparam.0 as *mut HWND;
    if !slot.is_null() {
        *slot = hwnd;
    }
    BOOL(0)
}

fn vk_for(key: &str) -> Option<u16> {
    match key {
        "a" => Some(0x41),
        "b" => Some(0x42),
        "c" => Some(0x43),
        "d" => Some(0x44),
        "e" => Some(0x45),
        "f" => Some(0x46),
        "g" => Some(0x47),
        "h" => Some(0x48),
        "i" => Some(0x49),
        "j" => Some(0x4A),
        "k" => Some(0x4B),
        "l" => Some(0x4C),
        "m" => Some(0x4D),
        "n" => Some(0x4E),
        "o" => Some(0x4F),
        "p" => Some(0x50),
        "q" => Some(0x51),
        "r" => Some(0x52),
        "s" => Some(0x53),
        "t" => Some(0x54),
        "u" => Some(0x55),
        "v" => Some(0x56),
        "w" => Some(0x57),
        "x" => Some(0x58),
        "y" => Some(0x59),
        "z" => Some(0x5A),
        "0" => Some(0x30),
        "1" => Some(0x31),
        "2" => Some(0x32),
        "3" => Some(0x33),
        "4" => Some(0x34),
        "5" => Some(0x35),
        "6" => Some(0x36),
        "7" => Some(0x37),
        "8" => Some(0x38),
        "9" => Some(0x39),
        ";" => Some(0xBA),
        "=" => Some(0xBB),
        "," => Some(0xBC),
        "-" => Some(0xBD),
        "." => Some(0xBE),
        "/" => Some(0xBF),
        "`" => Some(0xC0),
        "[" => Some(0xDB),
        "\\" => Some(0xDC),
        "]" => Some(0xDD),
        "'" => Some(0xDE),
        _ => None,
    }
}

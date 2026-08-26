use crate::FaceBus;
use raw_window_handle::{HasRawWindowHandle, RawWindowHandle};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use windows::core::{factory, implement, Interface, HSTRING};
use windows::ApplicationModel::DataTransfer::{
    DataRequestedEventArgs, DataTransferManager,
};
use windows::Foundation::Collections::{IIterable, IIterable_Impl, IIterator, IIterator_Impl};
use windows::Foundation::TypedEventHandler;
use windows::Storage::{IStorageItem, StorageFile};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_SINGLETHREADED};
use windows::Win32::UI::Shell::IDataTransferManagerInterop;

struct Pending {
    file: Option<StorageFile>,
    title: String,
    text: String,
}

struct Host {
    hwnd: HWND,
    interop: IDataTransferManagerInterop,
    #[allow(dead_code)]
    dtm: DataTransferManager,
}

static HOST: Mutex<Option<Host>> = Mutex::new(None);
static PENDING: Mutex<Pending> = Mutex::new(Pending {
    file: None,
    title: String::new(),
    text: String::new(),
});

#[implement(IIterable<IStorageItem>)]
struct OneItem(IStorageItem);

impl IIterable_Impl<IStorageItem> for OneItem {
    fn First(&self) -> windows::core::Result<IIterator<IStorageItem>> {
        Ok(OneIter {
            item: self.0.clone(),
            taken: AtomicBool::new(false),
        }
        .into())
    }
}

#[implement(IIterator<IStorageItem>)]
struct OneIter {
    item: IStorageItem,
    taken: AtomicBool,
}

impl IIterator_Impl<IStorageItem> for OneIter {
    fn Current(&self) -> windows::core::Result<IStorageItem> {
        Ok(self.item.clone())
    }
    fn HasCurrent(&self) -> windows::core::Result<bool> {
        Ok(!self.taken.load(Ordering::Relaxed))
    }
    fn MoveNext(&self) -> windows::core::Result<bool> {
        self.taken.store(true, Ordering::Relaxed);
        Ok(false)
    }
    fn GetMany(
        &self,
        items: &mut [<IStorageItem as windows::core::Type<IStorageItem>>::Default],
    ) -> windows::core::Result<u32> {
        if self.taken.load(Ordering::Relaxed) || items.is_empty() {
            return Ok(0);
        }
        items[0] = Some(self.item.clone());
        self.taken.store(true, Ordering::Relaxed);
        Ok(1)
    }
}

fn hwnd_of(window: &baseview::Window) -> Option<HWND> {
    match window.raw_window_handle() {
        RawWindowHandle::Win32(h) => Some(HWND(h.hwnd as isize)),
        _ => None,
    }
}

fn resolve_path(bus: &FaceBus, name: &str) -> Option<PathBuf> {
    crate::files::find_download(name).or_else(|| bus.last_video.lock().ok().and_then(|g| g.clone()))
}

fn fill_request(args: &DataRequestedEventArgs) -> windows::core::Result<()> {
    let pending = PENDING.lock().ok();
    let Some(pending) = pending.as_ref() else {
        return Ok(());
    };
    let request = args.Request()?;
    let data = request.Data()?;
    let props = data.Properties()?;
    props.SetTitle(&HSTRING::from(pending.title.as_str()))?;
    if !pending.text.is_empty() {
        let _ = props.SetDescription(&HSTRING::from(pending.text.as_str()));
        let _ = data.SetText(&HSTRING::from(pending.text.as_str()));
    }
    if let Some(file) = pending.file.as_ref() {
        let item: IStorageItem = file.cast()?;
        let list: IIterable<IStorageItem> = OneItem(item).into();
        data.SetStorageItemsReadOnly(&list)?;
    }
    Ok(())
}

fn ensure_host(hwnd: HWND) -> windows::core::Result<()> {
    let mut slot = HOST.lock().map_err(|_| windows::core::Error::empty())?;
    if let Some(host) = slot.as_ref() {
        if host.hwnd == hwnd {
            return Ok(());
        }
    }
    let _ = unsafe { RoInitialize(RO_INIT_SINGLETHREADED) };
    let interop: IDataTransferManagerInterop =
        factory::<DataTransferManager, IDataTransferManagerInterop>()?;
    let dtm: DataTransferManager = unsafe { interop.GetForWindow(hwnd)? };
    dtm.DataRequested(&TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(
        |_, args| {
            if let Some(args) = args {
                let _ = fill_request(args);
            }
            Ok(())
        },
    ))?;
    *slot = Some(Host { hwnd, interop, dtm });
    Ok(())
}

fn show(hwnd: HWND, path: &Path, title: &str, text: &str) -> windows::core::Result<()> {
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.to_string_lossy().as_ref()))?
        .get()?;
    {
        let mut pending = PENDING.lock().map_err(|_| windows::core::Error::empty())?;
        pending.file = Some(file);
        pending.title = title.to_string();
        pending.text = text.to_string();
    }
    ensure_host(hwnd)?;
    let host = HOST.lock().map_err(|_| windows::core::Error::empty())?;
    let host = host.as_ref().ok_or_else(windows::core::Error::empty)?;
    unsafe { host.interop.ShowShareUIForWindow(hwnd) }
}

pub fn share(window: &baseview::Window, bus: &FaceBus, name: &str, text: &str) -> bool {
    let Some(hwnd) = hwnd_of(window) else {
        return false;
    };
    let Some(path) = resolve_path(bus, name) else {
        return false;
    };
    let title = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Ear Wyrm");
    show(hwnd, &path, title, text).is_ok()
}

use crate::FaceBus;
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use windows::core::{factory, implement, Interface, HSTRING};
use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
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

thread_local! {
    static HOST: RefCell<Option<Host>> = const { RefCell::new(None) };
    static PENDING: RefCell<Pending> = const {
        RefCell::new(Pending {
            file: None,
            title: String::new(),
            text: String::new(),
        })
    };
}

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

fn resolve_path(bus: &FaceBus, name: &str) -> Option<PathBuf> {
    crate::files::find_download(name).or_else(|| bus.last_video.lock().ok().and_then(|g| g.clone()))
}

fn fill_request(args: &DataRequestedEventArgs) -> windows::core::Result<()> {
    PENDING.with(|slot| {
        let pending = slot.borrow();
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
    })
}

fn ensure_host(hwnd: HWND) -> windows::core::Result<()> {
    HOST.with(|slot| {
        {
            let host = slot.borrow();
            if let Some(host) = host.as_ref() {
                if host.hwnd == hwnd {
                    return Ok(());
                }
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
        *slot.borrow_mut() = Some(Host { hwnd, interop, dtm });
        Ok(())
    })
}

fn show(hwnd: HWND, path: &Path, title: &str, text: &str) -> windows::core::Result<()> {
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.to_string_lossy().as_ref()))?
        .get()?;
    PENDING.with(|slot| {
        let mut pending = slot.borrow_mut();
        pending.file = Some(file);
        pending.title = title.to_string();
        pending.text = text.to_string();
    });
    ensure_host(hwnd)?;
    HOST.with(|slot| {
        let host = slot.borrow();
        let host = host.as_ref().ok_or_else(windows::core::Error::empty)?;
        unsafe { host.interop.ShowShareUIForWindow(hwnd) }
    })
}

pub fn share(hwnd: isize, bus: &FaceBus, name: &str, text: &str) -> bool {
    let Some(path) = resolve_path(bus, name) else {
        return false;
    };
    let title = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Ear Wyrm");
    show(HWND(hwnd), &path, title, text).is_ok()
}

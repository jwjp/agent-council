//! Native-only vault. No frontend commands or permissions.
#[cfg(mobile)]
use serde::{Deserialize, Serialize};
#[cfg(mobile)]
use tauri::plugin::PluginHandle;
use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};
#[cfg(mobile)]
#[derive(Deserialize)]
struct Stored {
    value: Option<String>,
}
#[cfg(mobile)]
#[derive(Serialize)]
struct Save<'a> {
    value: &'a str,
}
pub struct SecureLink<R: Runtime> {
    #[cfg(mobile)]
    handle: PluginHandle<R>,
    #[cfg(desktop)]
    _runtime: std::marker::PhantomData<fn() -> R>,
}
impl<R: Runtime> SecureLink<R> {
    pub fn load(&self) -> Result<Option<String>, String> {
        #[cfg(mobile)]
        {
            self.handle
                .run_mobile_plugin::<Stored>("load", ())
                .map(|s| s.value)
                .map_err(|_| {
                    "Cannot unlock the saved connection. Unlock this device and retry.".into()
                })
        }
        #[cfg(desktop)]
        {
            Err("Native secure storage requires iOS or Android.".into())
        }
    }
    pub fn save(&self, value: &str) -> Result<(), String> {
        #[cfg(mobile)]
        {
            self.handle
                .run_mobile_plugin::<serde_json::Value>("save", Save { value })
                .map(|_| ())
                .map_err(|_| "Could not securely save the connection.".into())
        }
        #[cfg(desktop)]
        {
            let _ = value;
            Err("Native secure storage requires iOS or Android.".into())
        }
    }
    pub fn clear(&self) -> Result<(), String> {
        #[cfg(mobile)]
        {
            self.handle
                .run_mobile_plugin::<serde_json::Value>("clear", ())
                .map(|_| ())
                .map_err(|_| "Could not remove the saved connection.".into())
        }
        #[cfg(desktop)]
        {
            Err("Native secure storage requires iOS or Android.".into())
        }
    }
    pub fn open_web(&self, url: &str) -> Result<(), String> {
        #[cfg(mobile)]
        {
            self.handle
                .run_mobile_plugin::<serde_json::Value>("openWeb", serde_json::json!({"url":url}))
                .map(|_| ())
                .map_err(|_| "Cannot open the browser.".into())
        }
        #[cfg(desktop)]
        {
            let _ = url;
            Err("Requires a mobile device.".into())
        }
    }
}
pub trait SecureLinkExt<R: Runtime> {
    fn secure_link(&self) -> &SecureLink<R>;
}
impl<R: Runtime, T: Manager<R>> SecureLinkExt<R> for T {
    fn secure_link(&self) -> &SecureLink<R> {
        self.state::<SecureLink<R>>().inner()
    }
}
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_secure_link);
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("secure-link")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let vault = SecureLink {
                handle: api.register_ios_plugin(init_plugin_secure_link)?,
            };
            #[cfg(target_os = "android")]
            let vault = SecureLink {
                handle: api
                    .register_android_plugin("dev.agentcouncil.securelink", "SecureLinkPlugin")?,
            };
            #[cfg(desktop)]
            let vault = {
                let _ = api;
                SecureLink::<R> {
                    _runtime: std::marker::PhantomData,
                }
            };
            app.manage(vault);
            Ok(())
        })
        .build()
}

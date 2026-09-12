//! Preview thumbnails — replaces Electron's `nativeImage` resize path.
//!
//! Large mod previews (multi-MB PNGs) are decoded and downscaled in Rust so
//! the IPC payload to the webview stays small and ready to display.

use base64::Engine;
use std::path::Path;

/// Longest side of a generated thumbnail.
pub const PREVIEW_THUMB_MAX: u32 = 640;

fn encode_data_url(bytes: &[u8], mime: &str) -> String {
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Downscale an in-memory image to a JPEG data URL. Falls back to the raw
/// bytes (as the given mime) if decoding fails.
pub fn thumbnail_data_url(buf: &[u8], fallback_mime: &str) -> String {
    match image::load_from_memory(buf) {
        Ok(img) => {
            let (w, h) = (img.width(), img.height());
            let max = w.max(h);
            let img = if max > PREVIEW_THUMB_MAX {
                let scale = PREVIEW_THUMB_MAX as f32 / max as f32;
                img.resize(
                    ((w as f32 * scale).round() as u32).max(1),
                    ((h as f32 * scale).round() as u32).max(1),
                    image::imageops::FilterType::Triangle,
                )
            } else {
                img
            };
            let rgb = img.to_rgb8();
            let mut out = std::io::Cursor::new(Vec::new());
            let encoded = {
                let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82);
                enc.encode_image(&rgb)
            };
            match encoded {
                Ok(()) => encode_data_url(out.get_ref(), "image/jpeg"),
                Err(_) => encode_data_url(buf, fallback_mime),
            }
        }
        Err(_) => encode_data_url(buf, fallback_mime),
    }
}

/// Read an on-disk preview and return a thumbnail data URL (or `None`).
pub fn file_to_data_url(path: &Path) -> Option<String> {
    let buf = std::fs::read(path).ok()?;
    if buf.is_empty() {
        return None;
    }
    let mime = crate::util::image_mime(&crate::util::ext_lower(path));
    Some(thumbnail_data_url(&buf, mime))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downscales_large_png() {
        let img = image::RgbImage::from_fn(1600, 900, |x, y| image::Rgb([(x % 255) as u8, (y % 255) as u8, 128]));
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img).write_to(&mut png, image::ImageFormat::Png).unwrap();
        let url = thumbnail_data_url(png.get_ref(), "image/png");
        assert!(url.starts_with("data:image/jpeg;base64,"));
        let b64 = &url["data:image/jpeg;base64,".len()..];
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(decoded.width(), 640);
        assert_eq!(decoded.height(), 360);
    }

    #[test]
    fn garbage_falls_back_to_raw() {
        let url = thumbnail_data_url(b"not an image", "image/png");
        assert!(url.starts_with("data:image/png;base64,"));
    }
}

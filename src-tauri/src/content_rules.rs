//! Read-only detection rules reused from UHM Pack Installer v1.0.0.
//! Source: commit 12538c48be54e95dfe52bca9e0f04ecb38826213, library.rs.
//! Filesystem access stays in content.rs behind safe_target; these are candidates,
//! never guessed metadata, origin classifications, or permission to mutate files.
const CAR_PREVIEWS: &[&str] = &[
    "ui/preview.png",
    "ui/preview.jpg",
    "ui/preview.jpeg",
    "ui/preview_light.png",
    "ui/preview_light.jpg",
    "ui/preview_light.jpeg",
    "ui/preview_2.png",
    "ui/preview_2.jpg",
    "ui/preview_2.jpeg",
    "preview.png",
    "preview.jpg",
    "preview.jpeg",
    "ui/ui_preview.jpg",
];
const TRACK_PREVIEWS: &[&str] = &[
    "ui/preview.png",
    "ui/preview.jpg",
    "ui/preview.jpeg",
    "ui/preview_light.png",
    "ui/preview_light.jpg",
    "ui/preview_light.jpeg",
    "preview.png",
    "preview.jpg",
    "preview.jpeg",
    "ui/ui_preview.jpg",
    "ui/preview_2.png",
    "ui/preview_2.jpg",
    "ui/preview_2.jpeg",
];
pub fn preview_candidates(base: &str, car: bool) -> Vec<String> {
    (if car { CAR_PREVIEWS } else { TRACK_PREVIEWS })
        .iter()
        .map(|relative| format!("{base}/{relative}"))
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_released_preview_order_and_jpeg_alternatives() {
        let cars = preview_candidates("content/cars/example", true);
        assert_eq!(cars[0], "content/cars/example/ui/preview.png");
        assert!(cars.contains(&"content/cars/example/preview.jpeg".into()));
        assert!(cars.contains(&"content/cars/example/ui/preview_light.jpg".into()));
        let tracks = preview_candidates("content/tracks/example/ui/sprint", false);
        assert_eq!(tracks[0], "content/tracks/example/ui/sprint/ui/preview.png");
        assert!(tracks.contains(&"content/tracks/example/ui/sprint/preview.jpg".into()));
        assert!(cars
            .iter()
            .all(|p| crate::security::relative_path(p).is_ok()));
    }
}

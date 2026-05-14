use crate::image_store::ImageFetchError;
use core::f32;
use image::DynamicImage;
use rand::seq::SliceRandom;

#[derive(Debug, Clone)]
pub struct Image {
    pub url: String,
    pub width: i64,
    pub height: i64,
}

/// DuckDuckGo image search (HTML + JSON scraping).
/// Returns the image closest to the requested aspect ratio and resizes it to 380x475.
pub fn search(query: &str, width: u32, height: u32) -> Result<DynamicImage, ImageFetchError> {
    let search_url = format!("https://duckduckgo.com/?q={}&iax=images&ia=images", query);
    let client = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
        .build()?;

    // Get the vqd out of the HTML
    let html = client.get(&search_url).send()?.text()?;
    let vqd = extract_vqd(&html).ok_or(ImageFetchError {
        details: "Failed to extract DuckDuckGo vqd token".to_string(),
    })?;

    // Get urls for all images in the search.
    let json_url = format!("https://duckduckgo.com/i.js?q={}&vqd={}&o=js", query, vqd);
    let json_text = client
        .get(&json_url)
        .header("Referer", "https://duckduckgo.com/")
        .send()?
        .text()?;
    let image_urls = get_ddg_image_urls(json_text);

    // Pick a random image from the top 10 that best match the desired aspect ratio
    let mut images_with_ratio: Vec<(f32, Image)> = image_urls
        .into_iter()
        .map(|img| {
            let ratio_diff =
                f32::abs(img.width as f32 / img.height as f32 - width as f32 / height as f32);
            (ratio_diff, img)
        })
        .collect();
    images_with_ratio.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    let top_matches: Vec<Image> = images_with_ratio
        .into_iter()
        .take(10)
        .map(|(_, img)| img)
        .collect();

    let mut rng = rand::thread_rng();
    let mut candidates = top_matches;
    candidates.shuffle(&mut rng);

    let mut last_error = None;
    for image in candidates {
        if image.url.is_empty() {
            continue;
        }

        let response = match client.get(&image.url).send() {
            Ok(response) => response,
            Err(e) => {
                last_error = Some(e.to_string());
                continue;
            }
        };

        if !response.status().is_success() {
            last_error = Some(format!("image request failed with {}", response.status()));
            continue;
        }

        let img_bytes = match response.bytes() {
            Ok(bytes) => bytes,
            Err(e) => {
                last_error = Some(e.to_string());
                continue;
            }
        };

        match image::load_from_memory(&img_bytes) {
            Ok(img) => {
                return Ok(img.resize_exact(
                    width,
                    height,
                    image::imageops::FilterType::CatmullRom,
                ));
            }
            Err(e) => {
                last_error = Some(e.to_string());
            }
        }
    }

    Err(ImageFetchError {
        details: last_error.unwrap_or_else(|| "No usable image found".to_string()),
    })
}

fn extract_vqd(html: &str) -> Option<String> {
    let patterns = ["vqd=\"", "vqd='"];

    for pat in patterns {
        if let Some(start) = html.find(pat) {
            let start = start + pat.len();
            let rest = &html[start..];
            if let Some(end) = rest.find(['"', '\'']) {
                return Some(rest[..end].to_string());
            }
        }
    }

    None
}

fn get_ddg_image_urls(json_response: String) -> Vec<Image> {
    let json_res: serde_json::Value = match serde_json::from_str(&json_response) {
        Ok(val) => val,
        Err(_) => return vec![],
    };

    json_res
        .get("results")
        .and_then(|v| v.as_array())
        .unwrap_or(&vec![])
        .iter()
        .map(|item| Image {
            url: item
                .get("image")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            width: item
                .get("width")
                .and_then(|v| v.as_i64())
                .unwrap_or_default(),
            height: item
                .get("height")
                .and_then(|v| v.as_i64())
                .unwrap_or_default(),
        })
        .collect()
}

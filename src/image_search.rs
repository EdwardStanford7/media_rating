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
/// Returns usable images closest to the requested aspect ratio and resizes them.
pub fn search_many(
    query: &str,
    width: u32,
    height: u32,
    count: usize,
) -> Result<Vec<DynamicImage>, ImageFetchError> {
    let client = reqwest::blocking::Client::builder()
        .cookie_store(true)
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
        .build()?;

    let html = client
        .get("https://duckduckgo.com/")
        .query(&[("q", query), ("iax", "images"), ("ia", "images")])
        .send()?
        .text()?;
    let vqd = extract_vqd(&html).ok_or(ImageFetchError {
        details: "Failed to extract DuckDuckGo vqd token".to_string(),
    })?;

    let json_text = client
        .get("https://duckduckgo.com/i.js")
        .query(&[("q", query), ("vqd", vqd.as_str()), ("o", "js")])
        .header("Referer", "https://duckduckgo.com/")
        .send()?
        .text()?;
    let image_urls = get_ddg_image_urls(json_text);

    let mut images_with_ratio: Vec<(f32, Image)> = image_urls
        .into_iter()
        .filter(|img| img.width > 0 && img.height > 0 && !img.url.is_empty())
        .map(|img| {
            let ratio_diff =
                f32::abs(img.width as f32 / img.height as f32 - width as f32 / height as f32);
            (ratio_diff, img)
        })
        .collect();
    images_with_ratio.sort_by(|a, b| a.0.total_cmp(&b.0));
    let top_matches: Vec<Image> = images_with_ratio
        .into_iter()
        .take(count.saturating_mul(4).max(count))
        .map(|(_, img)| img)
        .collect();

    let mut rng = rand::thread_rng();
    let mut candidates = top_matches;
    candidates.shuffle(&mut rng);

    let mut results = Vec::new();
    let mut last_error = None;
    for image in candidates {
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
                results.push(img.resize_exact(
                    width,
                    height,
                    image::imageops::FilterType::CatmullRom,
                ));
                if results.len() >= count {
                    return Ok(results);
                }
            }
            Err(e) => {
                last_error = Some(e.to_string());
            }
        }
    }

    if results.is_empty() {
        Err(ImageFetchError {
            details: last_error.unwrap_or_else(|| "No usable image found".to_string()),
        })
    } else {
        Ok(results)
    }
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

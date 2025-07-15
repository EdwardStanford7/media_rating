APP_NAME = MediaRating
TARGET = target/release/media_rating
APP_DIR = target/release/$(APP_NAME).app
MACOS_DIR = $(APP_DIR)/Contents/MacOS
RESOURCES_DIR = $(APP_DIR)/Contents/Resources
ICON_FILE = icon.icns

.PHONY: app clean

app:
	cargo build --release
	mkdir -p $(MACOS_DIR)
	mkdir -p $(RESOURCES_DIR)
	cp $(TARGET) $(MACOS_DIR)/$(APP_NAME)
	cp $(ICON_FILE) $(RESOURCES_DIR)/

clean:
	cargo clean
	rm -rf $(APP_DIR)
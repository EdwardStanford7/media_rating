APP_NAME = MediaRating
TARGET_DIR = target/release
BINARY = $(TARGET_DIR)/media_rating
APP_DIR = $(TARGET_DIR)/$(APP_NAME).app
CONTENTS_DIR = $(APP_DIR)/Contents
MACOS_DIR = $(CONTENTS_DIR)/MacOS
RESOURCES_DIR = $(CONTENTS_DIR)/Resources
ICON_FILE = icon.icns
PLIST_FILE = $(CONTENTS_DIR)/Info.plist

.PHONY: app clean

app:
	cargo build --release
	mkdir -p $(MACOS_DIR) $(RESOURCES_DIR)
	cp $(BINARY) $(MACOS_DIR)/$(APP_NAME)
	[ -f $(ICON_FILE) ] && cp $(ICON_FILE) $(RESOURCES_DIR)/ || true
	echo '<?xml version="1.0" encoding="UTF-8"?>' > $(PLIST_FILE)
	echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' >> $(PLIST_FILE)
	echo '<plist version="1.0">' >> $(PLIST_FILE)
	echo '<dict>' >> $(PLIST_FILE)
	echo '    <key>CFBundleName</key>' >> $(PLIST_FILE)
	echo '    <string>$(APP_NAME)</string>' >> $(PLIST_FILE)
	echo '    <key>CFBundleExecutable</key>' >> $(PLIST_FILE)
	echo '    <string>$(APP_NAME)</string>' >> $(PLIST_FILE)
	echo '    <key>CFBundleIconFile</key>' >> $(PLIST_FILE)
	echo '    <string>icon.icns</string>' >> $(PLIST_FILE)
	echo '    <key>CFBundlePackageType</key>' >> $(PLIST_FILE)
	echo '    <string>APPL</string>' >> $(PLIST_FILE)
	echo '</dict>' >> $(PLIST_FILE)
	echo '</plist>' >> $(PLIST_FILE)

clean:
	cargo clean
	rm -rf $(APP_DIR)
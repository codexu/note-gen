// swift-tools-version:5.5

import PackageDescription

let package = Package(
    name: "notegen-ocr-ios",
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "notegen-ocr-ios",
            type: .static,
            targets: ["notegen-ocr-ios"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: ".tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "notegen-ocr-ios",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)

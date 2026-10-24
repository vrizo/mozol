// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MozolCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MozolCore", targets: ["MozolCore"]),
    ],
    targets: [
        .target(name: "MozolCore"),
        .testTarget(name: "MozolCoreTests", dependencies: ["MozolCore"]),
    ]
)

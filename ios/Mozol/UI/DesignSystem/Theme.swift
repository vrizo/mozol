import SwiftUI
import UIKit

/// Tokens of docs/web/design-system.md for SwiftUI: colors, type, shape, space.
extension Color {
    static let paper = Color(hex: 0xF3F2EE)
    static let surface = Color(hex: 0xFBFAF7)
    static let ink = Color(hex: 0x111111)
    static let ink2 = Color(hex: 0x55554F)
    static let muted = Color(hex: 0x8A8A86)
    static let line = Color(hex: 0xD9D7CF)
    static let danger = Color(hex: 0xA3241B)
    static let onInk = Color(hex: 0xF3F2EE)

    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

extension UIColor {
    static let paper = UIColor(Color.paper)
    static let ink = UIColor(Color.ink)
}

enum Space {
    static let s1: CGFloat = 4
    static let s2: CGFloat = 8
    static let s3: CGFloat = 12
    static let s4: CGFloat = 16
    static let s5: CGFloat = 20
    static let s6: CGFloat = 24
    static let s8: CGFloat = 32
    static let s10: CGFloat = 40
    static let s12: CGFloat = 48
}

enum Outline {
    static let border: CGFloat = 2
    static let shadow: CGFloat = 4
    static let touch: CGFloat = 44
}

extension Font {
    /// Helvetica Neue at a design-system size, scaled with Dynamic Type.
    static func sans(_ size: CGFloat, weight: Weight = .regular, relativeTo style: TextStyle = .body) -> Font {
        let name = switch weight {
        case .bold, .heavy, .black, .semibold: "HelveticaNeue-Bold"
        case .medium: "HelveticaNeue-Medium"
        default: "HelveticaNeue"
        }
        return .custom(name, size: size, relativeTo: style)
    }

    /// The system monospace font: labels, timestamps, codes.
    static func mono(_ style: TextStyle, weight: Weight = .regular) -> Font {
        .system(style, design: .monospaced, weight: weight)
    }

    static let heading = sans(32, weight: .bold, relativeTo: .largeTitle)
    static let bodyText = sans(16)
    static let secondaryText = sans(14, relativeTo: .subheadline)
}

/// Navigation bar titles in Helvetica Neue, ink. The bar itself stays the system one.
enum Appearance {
    static func apply() {
        let bar = UINavigationBar.appearance()
        bar.titleTextAttributes = [
            .foregroundColor: UIColor.ink,
            .font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: UIFont(name: "HelveticaNeue-Bold", size: 17)!),
        ]
        bar.largeTitleTextAttributes = [
            .foregroundColor: UIColor.ink,
            .font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: UIFont(name: "HelveticaNeue-Bold", size: 32)!),
        ]
    }
}

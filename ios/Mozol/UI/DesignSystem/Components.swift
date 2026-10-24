import SwiftUI

/// Components of docs/web/design-system.md: buttons, field, card, label, tag, loading row.

/// Ink fill, paper text, hard shadow. Pressed: moves down-right onto its shadow.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let offset: CGFloat = configuration.isPressed ? Outline.shadow / 2 : 0
        configuration.label
            .font(.sans(16, weight: .bold))
            .foregroundStyle(isEnabled ? Color.onInk : Color.ink2)
            .padding(.vertical, Space.s3)
            .padding(.horizontal, Space.s5)
            .frame(maxWidth: .infinity, minHeight: Outline.touch)
            .background(isEnabled ? Color.ink : Color.line)
            .overlay(Rectangle().strokeBorder(isEnabled ? Color.ink : Color.muted, lineWidth: Outline.border))
            .background(
                Rectangle()
                    .fill(Color.muted)
                    .offset(x: Outline.shadow - offset, y: Outline.shadow - offset)
                    .opacity(isEnabled ? 1 : 0)
            )
            .offset(x: offset, y: offset)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Transparent, 2 px ink border, no shadow. Pressed: ink fill.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        let tint = Color.ink
        configuration.label
            .font(.sans(16, weight: .bold))
            .foregroundStyle(configuration.isPressed ? Color.onInk : tint)
            .padding(.vertical, Space.s3)
            .padding(.horizontal, Space.s5)
            .frame(maxWidth: .infinity, minHeight: Outline.touch)
            .background(configuration.isPressed ? tint : .clear)
            .overlay(Rectangle().strokeBorder(tint, lineWidth: Outline.border))
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Ink text, underlined with a 3 px offset.
struct TextLinkStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.sans(16, weight: .medium))
            .foregroundStyle(Color.ink)
            .underline()
            .frame(minHeight: Outline.touch)
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var secondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}

extension ButtonStyle where Self == TextLinkStyle {
    static var textLink: TextLinkStyle { TextLinkStyle() }
}

/// Surface fill, 2 px border (danger on error), 44 px high.
struct InkFieldStyle: TextFieldStyle {
    var isError = false

    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(.bodyText)
            .foregroundStyle(Color.ink)
            .tint(Color.ink)
            .padding(.horizontal, Space.s3)
            .frame(minHeight: Outline.touch)
            .background(Color.surface)
            .overlay(Rectangle().strokeBorder(isError ? Color.danger : Color.ink, lineWidth: Outline.border))
    }
}

/// Mono 12 px, bold, uppercase, wide tracking. A section label starts with "+ ".
struct SectionLabel: View {
    let text: LocalizedStringKey
    var plus = true

    var body: some View {
        HStack(spacing: 0) {
            if plus { Text(verbatim: "+ ") }
            Text(text)
        }
        .font(.mono(.caption, weight: .semibold))
        .textCase(.uppercase)
        .tracking(1.4)
        .foregroundStyle(Color.ink)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Mono 12 px uppercase in a 2 px ink border, no fill.
struct Tag: View {
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(.mono(.caption, weight: .semibold))
            .textCase(.uppercase)
            .tracking(1.4)
            .foregroundStyle(Color.ink)
            .padding(.horizontal, Space.s2)
            .padding(.vertical, 2)
            .overlay(Rectangle().strokeBorder(Color.ink, lineWidth: Outline.border))
    }
}

/// Surface fill, 2 px ink border; a hard shadow when it is clickable.
struct CardModifier: ViewModifier {
    var raised = false

    func body(content: Content) -> some View {
        content
            .background(Color.surface)
            .overlay(Rectangle().strokeBorder(Color.ink, lineWidth: Outline.border))
            .background(
                Rectangle()
                    .fill(Color.muted)
                    .offset(x: Outline.shadow, y: Outline.shadow)
                    .opacity(raised ? 1 : 0)
            )
    }
}

extension View {
    func card(raised: Bool = false) -> some View {
        modifier(CardModifier(raised: raised))
    }

    /// The paper background behind a whole screen.
    func paperBackground() -> some View {
        background(Color.paper.ignoresSafeArea())
    }
}

/// A 2 px dotted ink rule between page sections.
struct DottedRule: View {
    var body: some View {
        Rectangle()
            .fill(.clear)
            .frame(height: Outline.border)
            .overlay(
                Line()
                    .stroke(Color.ink, style: StrokeStyle(lineWidth: Outline.border, dash: [2, 4]))
            )
            .accessibilityHidden(true)
    }

    private struct Line: Shape {
        func path(in rect: CGRect) -> Path {
            Path { path in
                path.move(to: CGPoint(x: 0, y: rect.midY))
                path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            }
        }
    }
}

/// A row of "+" characters that appear one after another.
struct PlusLoadingRow: View {
    var count = 5

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.2)) { context in
            let step = Int(context.date.timeIntervalSinceReferenceDate / 0.2) % (count + 1)
            HStack(spacing: 2) {
                ForEach(0..<count, id: \.self) { index in
                    Text(verbatim: "+")
                        .opacity(reduceMotion || index < step ? 1 : 0)
                }
            }
        }
        .font(.mono(.caption, weight: .bold))
        .foregroundStyle(Color.ink)
        .accessibilityHidden(true)
    }
}

/// A label and its value in one row of a card.
struct CardRow<Value: View>: View {
    let label: LocalizedStringKey
    @ViewBuilder let value: Value

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s3) {
            Text(label)
                .font(.secondaryText)
                .foregroundStyle(Color.ink2)
            Spacer(minLength: Space.s3)
            value
                .font(.bodyText)
                .foregroundStyle(Color.ink)
                .multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.s3)
        .frame(minHeight: Outline.touch)
        .accessibilityElement(children: .combine)
    }
}

/// A 1 px --line divider inside a card.
struct CardDivider: View {
    var body: some View {
        Rectangle().fill(Color.line).frame(height: 1).accessibilityHidden(true)
    }
}

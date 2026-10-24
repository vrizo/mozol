// Renders an SVG into a PNG with transparency, at the given pixel size. Usage: swift scripts/render-svg.swift in.svg out.png width height
import AppKit

let args = CommandLine.arguments
guard args.count == 5, let w = Int(args[3]), let h = Int(args[4]) else {
  fatalError("usage: render-svg.swift in.svg out.png width height")
}
guard let image = NSImage(contentsOf: URL(fileURLWithPath: args[1])) else { fatalError("cannot read SVG \(args[1])") }
guard let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4,
  hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
else { fatalError("cannot create bitmap") }
rep.size = NSSize(width: w, height: h)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
image.draw(in: NSRect(x: 0, y: 0, width: w, height: h))
NSGraphicsContext.restoreGraphicsState()
guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("cannot encode PNG") }
try png.write(to: URL(fileURLWithPath: args[2]))

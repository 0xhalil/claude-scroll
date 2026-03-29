import Cocoa
if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
    for window in list {
        if let name = window["kCGWindowOwnerName"] as? String,
           (name == "Code" || name == "Visual Studio Code"),
           let bounds = window["kCGWindowBounds"] as? [String: Any],
           let x = bounds["X"] as? CGFloat,
           let y = bounds["Y"] as? CGFloat,
           let w = bounds["Width"] as? CGFloat,
           let h = bounds["Height"] as? CGFloat,
           w > 200 {
            print("\(Int(x)),\(Int(y)),\(Int(w)),\(Int(h))")
            exit(0)
        }
    }
}

import Foundation
import QuickLook
import UniformTypeIdentifiers
import UIKit
import Vision
import Tauri

struct RecognizedLine {
    let text: String
    let x: CGFloat
    let y: CGFloat
}

struct RecognizeArgs: Decodable {
    let imagePath: String
    let languages: [String]?
}

struct RecognizeResponse: Encodable {
    let text: String
}

struct FolderBookmarkArgs: Decodable {
    let bookmarkBase64: String
}

private struct OpenRecordFileArgs: Decodable {
    let path: String
}

private final class RecordFilePreviewSource: NSObject, QLPreviewControllerDataSource {
    let item: NSURL

    init(url: URL) {
        item = url as NSURL
        super.init()
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        1
    }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        item
    }
}

struct FolderPickerResponse: Encodable {
    let cancelled: Bool
    let path: String?
    let bookmarkBase64: String?
    let displayName: String?
}

struct ActiveFolderAccess {
    let url: URL
    let bookmarkData: Data
}

struct OcrFailure: Error, LocalizedError {
    let message: String

    var errorDescription: String? {
        message
    }
}

func normalizeLanguage(_ language: String) -> String? {
    let normalized = language
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "_", with: "-")
        .lowercased()

    if normalized.isEmpty {
        return nil
    }

    switch normalized {
    case "eng", "en", "en-us":
        return "en-US"
    case "chi-sim", "zh", "zh-cn", "zh-hans":
        return "zh-Hans"
    case "chi-tra", "zh-tw", "zh-hant":
        return "zh-Hant"
    case "jpn", "ja", "ja-jp":
        return "ja-JP"
    case "kor", "ko", "ko-kr":
        return "ko-KR"
    default:
        return language
    }
}

func defaultRecognitionLanguages() -> [String] {
    [
        "zh-Hans",
        "zh-Hant",
        "en-US",
        "ja-JP",
        "ko-KR",
    ]
}

func supportedRecognitionLanguages(for request: VNRecognizeTextRequest) -> Set<String> {
    guard #available(iOS 15.0, *) else {
        return []
    }

    do {
        return Set(try request.supportedRecognitionLanguages())
    } catch {
        return []
    }
}

func setRecognitionLanguages(_ languages: [String], for request: VNRecognizeTextRequest) {
    let normalizedLanguages = languages.compactMap(normalizeLanguage)
    let candidateLanguages = normalizedLanguages.isEmpty
        ? defaultRecognitionLanguages()
        : normalizedLanguages
    let supportedLanguages = supportedRecognitionLanguages(for: request)
    let usableLanguages = supportedLanguages.isEmpty
        ? candidateLanguages
        : candidateLanguages.filter { supportedLanguages.contains($0) }

    if !usableLanguages.isEmpty {
        request.recognitionLanguages = usableLanguages
    }
}

func sortedRecognizedLines(from observations: [VNRecognizedTextObservation]) -> [String] {
    observations.compactMap { observation -> RecognizedLine? in
        guard let candidate = observation.topCandidates(1).first else {
            return nil
        }

        return RecognizedLine(
            text: candidate.string,
            x: observation.boundingBox.minX,
            y: observation.boundingBox.midY
        )
    }
    .sorted { lhs, rhs in
        if abs(lhs.y - rhs.y) > 0.02 {
            return lhs.y > rhs.y
        }

        return lhs.x < rhs.x
    }
    .map(\.text)
}

func recognizeText(imagePath: String, languages: [String]) throws -> String {
    guard !imagePath.isEmpty else {
        throw OcrFailure(message: "Missing imagePath")
    }

    let imageUrl = URL(fileURLWithPath: imagePath)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    if #available(iOS 16.0, *) {
        request.automaticallyDetectsLanguage = true
    }

    setRecognitionLanguages(languages, for: request)

    let handler = VNImageRequestHandler(url: imageUrl, options: [:])
    try handler.perform([request])

    return sortedRecognizedLines(from: request.results ?? []).joined(separator: "\n")
}

class OcrPlugin: Plugin, UIDocumentPickerDelegate, QLPreviewControllerDelegate {
    private var pendingFolderInvoke: Invoke?
    private var activeFolders: [String: ActiveFolderAccess] = [:]
    private weak var recordFileController: UIViewController?
    private var recordFilePreviewSource: RecordFilePreviewSource?
    deinit {
        var releasedURLs = Set<URL>()
        for active in activeFolders.values where releasedURLs.insert(active.url).inserted {
            active.url.stopAccessingSecurityScopedResource()
        }
    }

    private func folderResponse(url: URL, bookmarkData: Data) -> FolderPickerResponse {
        FolderPickerResponse(
            cancelled: false,
            path: url.path,
            bookmarkBase64: bookmarkData.base64EncodedString(),
            displayName: url.lastPathComponent
        )
    }

    private func createBookmark(for url: URL) throws -> Data {
        try url.bookmarkData(
            options: [],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
    }

    private func registerActiveFolder(url: URL, bookmarkData: Data) {
        let encodedBookmark = bookmarkData.base64EncodedString()
        if let existing = activeFolders.values.first(where: { $0.url == url }) {
            url.stopAccessingSecurityScopedResource()
            let active = ActiveFolderAccess(url: existing.url, bookmarkData: bookmarkData)
            let matchingKeys = activeFolders.compactMap { key, value in
                value.url == url ? key : nil
            }
            for key in matchingKeys {
                activeFolders[key] = active
            }
            activeFolders[encodedBookmark] = active
            return
        }

        activeFolders[encodedBookmark] = ActiveFolderAccess(url: url, bookmarkData: bookmarkData)
    }

    private func resolveBookmark(_ encodedBookmark: String) throws -> (URL, Data) {
        if let active = activeFolders[encodedBookmark] {
            return (active.url, active.bookmarkData)
        }

        guard let bookmarkData = Data(base64Encoded: encodedBookmark) else {
            throw OcrFailure(message: "The folder authorization is invalid.")
        }

        var isStale = false
        let resolutionOptions: URL.BookmarkResolutionOptions
        if #available(iOS 14.2, *) {
            resolutionOptions = [.withoutImplicitStartAccessing]
        } else {
            resolutionOptions = []
        }
        let url = try URL(
            resolvingBookmarkData: bookmarkData,
            options: resolutionOptions,
            relativeTo: nil,
            bookmarkDataIsStale: &isStale
        )

        if #available(iOS 14.2, *) {
            guard url.startAccessingSecurityScopedResource() else {
                throw OcrFailure(message: "NoteGen could not restore access to the selected folder.")
            }
        }

        let currentBookmark = isStale ? try createBookmark(for: url) : bookmarkData
        let currentEncodedBookmark = currentBookmark.base64EncodedString()
        registerActiveFolder(url: url, bookmarkData: currentBookmark)
        if let active = activeFolders[currentEncodedBookmark] {
            activeFolders[encodedBookmark] = active
        }
        return (url, currentBookmark)
    }

    @objc public func pickFolder(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard self.pendingFolderInvoke == nil else {
                invoke.reject("Another folder picker is already open.")
                return
            }
            guard let rootViewController = self.manager.viewController else {
                invoke.reject("The folder picker is unavailable.")
                return
            }

            let picker: UIDocumentPickerViewController
            if #available(iOS 14.0, *) {
                picker = UIDocumentPickerViewController(
                    forOpeningContentTypes: [.folder],
                    asCopy: false
                )
            } else {
                picker = UIDocumentPickerViewController(
                    documentTypes: ["public.folder"],
                    in: .open
                )
            }
            picker.delegate = self
            picker.allowsMultipleSelection = false
            UIUtils.centerPopover(rootViewController: rootViewController, popoverController: picker)
            self.pendingFolderInvoke = invoke

            var presenter = rootViewController
            while let presented = presenter.presentedViewController {
                presenter = presented
            }
            presenter.present(picker, animated: true)
        }
    }

    @objc public func openRecordFile(_ invoke: Invoke) {
        DispatchQueue.main.async {
            let path: String
            do {
                path = try invoke.parseArgs(OpenRecordFileArgs.self).path
            } catch {
                invoke.reject(error.localizedDescription)
                return
            }

            let fileURL = path.hasPrefix("/") ? URL(fileURLWithPath: path) : URL(string: path)
            guard let fileURL = fileURL,
                  fileURL.isFileURL,
                  fileURL.path.hasPrefix("/"),
                  (fileURL.host ?? "").isEmpty || fileURL.host?.lowercased() == "localhost",
                  (try? fileURL.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true,
                  FileManager.default.isReadableFile(atPath: fileURL.path) else {
                invoke.reject("The record file is unavailable or could not be read.")
                return
            }
            guard self.recordFileController == nil, var presenter = self.manager.viewController else {
                invoke.reject("The record file could not be opened right now.")
                return
            }
            while let presented = presenter.presentedViewController {
                presenter = presented
            }
            guard presenter.viewIfLoaded?.window != nil,
                  !presenter.isBeingPresented, !presenter.isBeingDismissed else {
                invoke.reject("The record file could not be opened right now.")
                return
            }

            let source = RecordFilePreviewSource(url: fileURL)
            let controller: UIViewController
            if QLPreviewController.canPreview(source.item) {
                let preview = QLPreviewController()
                preview.dataSource = source
                preview.delegate = self
                self.recordFilePreviewSource = source
                controller = preview
            } else {
                let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
                UIUtils.centerPopover(rootViewController: presenter, popoverController: activity)
                activity.completionWithItemsHandler = { [weak self, weak activity] _, _, _, _ in
                    if let activity = activity, self?.recordFileController === activity {
                        self?.recordFileController = nil
                    }
                }
                controller = activity
            }

            self.recordFileController = controller
            presenter.present(controller, animated: true) { invoke.resolve() }
        }
    }

    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        guard recordFileController === controller else { return }
        recordFileController = nil
        recordFilePreviewSource = nil
    }

    @objc public func restoreFolder(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(FolderBookmarkArgs.self)
        DispatchQueue.main.async {
            do {
                let (url, bookmarkData) = try self.resolveBookmark(args.bookmarkBase64)
                invoke.resolve(self.folderResponse(url: url, bookmarkData: bookmarkData))
            } catch {
                invoke.reject(error.localizedDescription)
            }
        }
    }

    @objc public func releaseFolder(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(FolderBookmarkArgs.self)
        DispatchQueue.main.async {
            if let active = self.activeFolders[args.bookmarkBase64] {
                self.activeFolders = self.activeFolders.filter { $0.value.url != active.url }
                active.url.stopAccessingSecurityScopedResource()
            }
            invoke.resolve()
        }
    }

    public func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        guard let invoke = pendingFolderInvoke else {
            return
        }
        pendingFolderInvoke = nil

        guard let url = urls.first else {
            invoke.resolve(FolderPickerResponse(cancelled: true, path: nil, bookmarkBase64: nil, displayName: nil))
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            invoke.reject("NoteGen could not access the selected folder.")
            return
        }

        do {
            let bookmarkData = try createBookmark(for: url)
            registerActiveFolder(url: url, bookmarkData: bookmarkData)
            invoke.resolve(folderResponse(url: url, bookmarkData: bookmarkData))
        } catch {
            url.stopAccessingSecurityScopedResource()
            invoke.reject(error.localizedDescription)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let invoke = pendingFolderInvoke else {
            return
        }
        pendingFolderInvoke = nil
        invoke.resolve(FolderPickerResponse(cancelled: true, path: nil, bookmarkBase64: nil, displayName: nil))
    }

    @objc public func recognize(_ invoke: Invoke) throws {
        do {
            let args = try invoke.parseArgs(RecognizeArgs.self)

            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let text = try recognizeText(
                        imagePath: args.imagePath,
                        languages: args.languages ?? []
                    )
                    DispatchQueue.main.async {
                        invoke.resolve(RecognizeResponse(text: text))
                    }
                } catch {
                    DispatchQueue.main.async {
                        invoke.reject(error.localizedDescription)
                    }
                }
            }
        } catch {
            invoke.reject(error.localizedDescription)
        }
    }
}

@_cdecl("init_plugin_ocr")
func initPlugin() -> Plugin {
    return OcrPlugin()
}

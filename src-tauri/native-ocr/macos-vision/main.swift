import Foundation
import Vision

struct OcrInput: Decodable {
    let imagePath: String?
    let languages: [String]?
}

struct OcrOutput: Encodable {
    let text: String
    let confidence: Float?
}

struct OcrFailure: Error, CustomStringConvertible {
    let description: String
}

func readInput() throws -> OcrInput {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    if data.isEmpty {
        throw OcrFailure(description: "Missing OCR input")
    }

    return try JSONDecoder().decode(OcrInput.self, from: data)
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

@available(macOS 10.15, *)
func supportedRecognitionLanguages(for request: VNRecognizeTextRequest) -> Set<String> {
    if #available(macOS 12.0, *) {
        do {
            return Set(try request.supportedRecognitionLanguages())
        } catch {
            return []
        }
    }
    return []
}

@available(macOS 10.15, *)
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

@available(macOS 10.15, *)
func sortedRecognizedLines(from observations: [VNRecognizedTextObservation]) -> [(text: String, confidence: Float, x: CGFloat, y: CGFloat)] {
    observations.compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else {
            return nil
        }

        return (
            text: candidate.string,
            confidence: candidate.confidence,
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
}

func recognizeText(input: OcrInput) throws -> OcrOutput {
    guard #available(macOS 10.15, *) else {
        throw OcrFailure(description: "macOS Vision OCR requires macOS 10.15 or later")
    }

    guard let imagePath = input.imagePath, !imagePath.isEmpty else {
        throw OcrFailure(description: "Missing imagePath")
    }

    let imageUrl = URL(fileURLWithPath: imagePath)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    if #available(macOS 13.0, *) {
        request.automaticallyDetectsLanguage = true
    }
    setRecognitionLanguages(input.languages ?? [], for: request)

    let handler = VNImageRequestHandler(url: imageUrl, options: [:])
    try handler.perform([request])

    let observations = request.results ?? []
    let lines = sortedRecognizedLines(from: observations)
    let text = lines.map(\.text).joined(separator: "\n")
    let confidence = lines.isEmpty
        ? nil
        : lines.map(\.confidence).reduce(0, +) / Float(lines.count)

    return OcrOutput(text: text, confidence: confidence)
}

do {
    let input = try readInput()
    let output = try recognizeText(input: input)
    let data = try JSONEncoder().encode(output)
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}

// CI-only OCR of a fresh simulator screenshot; no application credentials.
import Foundation
import Vision

guard CommandLine.arguments.count == 2 else {
    fatalError("Expected a simulator screenshot path")
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
request.usesLanguageCorrection = false
let handler = VNImageRequestHandler(
    url: URL(fileURLWithPath: CommandLine.arguments[1]), options: [:]
)
try handler.perform([request])
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
let output = try JSONSerialization.data(withJSONObject: lines)
FileHandle.standardOutput.write(output)

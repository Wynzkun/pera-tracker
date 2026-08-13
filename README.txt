PERA TRACKER V5

OCR IMPROVEMENTS
- Enhanced two-pass receipt OCR for thermal and dot-matrix receipts.
- Small photos are automatically upscaled before recognition.
- Auto-level grayscale and gentle sharpening improve faded print.
- Adaptive local thresholding helps with shadows, creases, glare and uneven paper.
- OCR uses both single-block and sparse-text passes and chooses the stronger result.
- Receipt parsing now handles OCR-spaced amounts such as P501. 00 and prioritizes TOTAL DUE / AMOUNT DUE over CASH / CHANGE.
- Added common receipt clues for merchant/category recovery when the receipt header is cropped or faint.

UPDATE EXISTING GITHUB PAGES APP
1. Extract this ZIP.
2. Upload/replace all files in the existing pera-tracker repository root.
3. Commit to main.
4. Wait for GitHub Pages deployment.
5. Open the site in Chrome with ?v=5 once, or use Menu > Refresh / Update App.

NOTES
- OCR still cannot recover text physically hidden by a finger, cut off from the photo, or completely blown out by glare.
- Very blurry photos can still require a retake, but V5 should materially improve the sample receipt types that V4 struggled with.
- Existing financial data remains in the same localStorage database key.

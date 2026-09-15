// Unity → host page events for the reconstruction viewer. The page installs
// window.caselineReconstructionEmit before Unity boots; if it is missing
// (standalone QA page) events are simply dropped.
mergeInto(LibraryManager.library, {
  CaselineReconstructionEmit: function (typePtr, token, detailPtr) {
    var type = UTF8ToString(typePtr);
    var detail = UTF8ToString(detailPtr);
    if (typeof window !== "undefined" && typeof window.caselineReconstructionEmit === "function") {
      window.caselineReconstructionEmit(type, token, detail);
    }
  },
});

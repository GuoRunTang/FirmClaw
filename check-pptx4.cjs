const p = require("C:/Users/a4253/AppData/Roaming/npm/node_modules/pptxgenjs");
const pptx = new p();
// Find the correct shape name
const keys = Object.keys(pptx.ShapeType);
const rectKeys = keys.filter(k => k.toLowerCase().includes("rect"));
console.log("rect-like keys:", rectKeys.join(", "));
const ovalKeys = keys.filter(k => k.toLowerCase().includes("oval") || k.toLowerCase().includes("ellipse"));
console.log("oval-like keys:", ovalKeys.join(", "));
const lineKeys = keys.filter(k => k.toLowerCase().includes("line"));
console.log("line-like keys:", lineKeys.join(", "));

// Test with pptx.shapes
console.log("\nshapes type:", typeof pptx.shapes);
if (pptx.shapes) {
  console.log("shapes keys:", Object.keys(pptx.shapes).slice(0, 20).join(", "));
}

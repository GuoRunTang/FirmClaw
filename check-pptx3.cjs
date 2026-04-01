const p = require("C:/Users/a4253/AppData/Roaming/npm/node_modules/pptxgenjs");
const pptx = new p();
console.log("ShapeType on instance:", typeof pptx.ShapeType);
if (pptx.ShapeType) {
  console.log("ShapeType keys:", Object.keys(pptx.ShapeType).slice(0, 20).join(", "));
}
console.log("shapes on instance:", typeof pptx.shapes);
// Test basic shape
const slide = pptx.addSlide();
try {
  slide.addShape(pptx.ShapeType.RECTANGLE, { x: 1, y: 1, w: 2, h: 1 });
  console.log("RECTANGLE works");
} catch(e) {
  console.log("RECTANGLE error:", e.message);
}

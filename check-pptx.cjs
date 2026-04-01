const p = require("C:/Users/a4253/AppData/Roaming/npm/node_modules/pptxgenjs");
console.log("shapes type:", typeof p.shapes);
console.log("ShapeType type:", typeof p.ShapeType);
if (p.shapes) console.log("shapes keys:", Object.keys(p.shapes).slice(0, 20).join(", "));
if (p.ShapeType) console.log("ShapeType keys:", Object.keys(p.ShapeType).slice(0, 20).join(", "));
console.log("has LINE:", p.ShapeType?.LINE, p.shapes?.LINE);
console.log("has RECTANGLE:", p.ShapeType?.RECTANGLE, p.shapes?.RECTANGLE);
console.log("has OVAL:", p.ShapeType?.OVAL, p.shapes?.OVAL);

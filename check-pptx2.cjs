const p = require("C:/Users/a4253/AppData/Roaming/npm/node_modules/pptxgenjs");
const proto = Object.getOwnPropertyNames(p);
console.log("prototype props:", proto.join(", "));
// Try to create instance and check
const pptx = new p();
console.log("instance created");
// Check what's on instance
const pptxKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(pptx));
console.log("pptx proto:", pptxKeys.join(", "));

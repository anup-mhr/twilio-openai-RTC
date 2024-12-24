import { processOrder } from "./processOrder.js";
import { searchProduct } from "./searchProduct.js";

const functionMapping = {
  // Example: "function_cal_name": functionImport,
  processOrder,
  searchProduct,
};

async function executeFunction(jsonData) {
  const functionName = jsonData.name;
  const args = jsonData.arguments;
  if (functionName in functionMapping) {
    return await functionMapping[functionName](args);
  } else {
    throw new Error(`Function ${functionName} not found in functionMapping.`);
  }
}

export default executeFunction;

export const search_product_definition = {
  type: "function",
  name: "searchProduct",
  description: `
        "Allows the user to search for a product in the ecommerce store's catalog by name. "
        "It returns the product name and price if available, otherwise it indicates that the product is not found."
    `,
  parameters: {
    type: "object",
    properties: {
      product_name: {
        type: "string",
        description: "The name of the product the user is searching for.",
      },
    },
    required: ["product_name"],
  },
};

export async function searchProduct(parameters) {
  const productName = parameters?.product_name;

  try {
    const productsData = await fs.readFile(
      "./src/dummyData/products.json",
      "utf-8"
    );
    const products = JSON.parse(productsData);

    const product = products.find(
      (product) => product.name.toLowerCase() === productName
    );

    if (product) {
      return {
        result: `The order with ID ${product.name} is ${product.price}.`,
      };
    }

    return { result: `No order found with ID ${productName}.` };
  } catch (error) {
    console.error("Error reading orders file:", error);
    return { result: "An error occurred while processing the order." };
  }
}

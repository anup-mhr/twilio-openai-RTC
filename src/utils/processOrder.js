import fs from "fs/promises";

export const process_order_definition = {
  type: "function",
  name: "processOrder",
  description: `
        "Allows the user to check the status of an order by providing the order ID. "
        "It returns the current status of the order, such as 'Processed', 'Pending', 'Shipped', or 'Delivered'."
    `,
  parameters: {
    type: "object",
    properties: {
      order_id: {
        type: "string",
        description: "The unique identifier (ID) of the order to check.",
      },
    },
    required: ["order_id"],
  },
};

export async function processOrder(parameters) {
  const orderId = parameters?.order_id;

  try {
    const ordersData = await fs.readFile(
      "./src/dummyData/orders.json",
      "utf-8"
    );
    const orders = JSON.parse(ordersData);

    const order = orders.find((order) => order.order_id === orderId);

    if (order) {
      return { result: `The order with ID ${orderId} is ${order.status}.` };
    }

    return { result: `No order found with ID ${orderId}.` };
  } catch (error) {
    console.error("Error reading orders file:", error);
    return { result: "An error occurred while processing the order." };
  }
}

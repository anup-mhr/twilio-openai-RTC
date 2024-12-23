// Function to check if a number is allowed to be called. With your own function, be sure
// to do your own diligence to be compliant.
async function isNumberAllowed(to) {
  try {
    // Uncomment these lines to test numbers. Only add numbers you have permission to call
    // const consentMap = {"+18005551212": true}
    // if (consentMap[to]) return true;

    // Check if the number is a Twilio phone number in the account, for example, when making a call to the Twilio Dev Phone
    const incomingNumbers = await client.incomingPhoneNumbers.list({
      phoneNumber: to,
    });
    if (incomingNumbers.length > 0) {
      return true;
    }

    // Check if the number is a verified outgoing caller ID. https://www.twilio.com/docs/voice/api/outgoing-caller-ids
    const outgoingCallerIds = await client.outgoingCallerIds.list({
      phoneNumber: to,
    });
    if (outgoingCallerIds.length > 0) {
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking phone number:", error);
    return false;
  }
}

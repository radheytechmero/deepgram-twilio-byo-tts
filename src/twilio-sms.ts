import 'dotenv/config';
const twilio = require('twilio');

type OrderItem = { id: string | number, menuItemName?: string, quantity?: number };

function getTwilioClient() {
    const accountSid = process.env.TWILIO_SID;
    const authToken = process.env.TWILIO_AUTH;
    if (!accountSid || !authToken) {
        throw new Error('Twilio credentials not configured. Set TWILIO_SID and TWILIO_AUTH.');
    }
    return twilio(accountSid, authToken);
}

export async function sendSMS(to: string, body: string, fromOverride?: string) {
    try {
        const client = getTwilioClient();
        if (!fromOverride) {
            throw new Error('From phone number is required. Pass restaurantNumber as fromOverride.');
        }
        const message = await client.messages.create({ to, from: fromOverride, body });
        return { success: true, sid: message.sid };
    } catch (error: any) {
        console.warn('SMS send failed:', error?.message || error);
        return { success: false, error: error?.message || 'Unknown SMS error' };
    }
}

export async function sendOrderPlacedMessage(params: {
    customerPhone: string,
    orderId: string,
    orderItems?: OrderItem[],
    etaText?: string,
    restaurantNumber: string | undefined
}) {
    const { customerPhone, orderId, orderItems = [], etaText, restaurantNumber } = params;
    
    if (!restaurantNumber) {
        throw new Error('Restaurant number is required to send SMS');
    }
    
    const summary = orderItems
        .filter(Boolean)
        .map(i => `${i.quantity || 1}x ${i.menuItemName || i.id}`)
        .join(', ');

    const lines = [
        `Thank you for your order!`,
        `Order #${orderId}`,
    ];
    if (summary) lines.push(`Items: ${summary}`);
    if (etaText) lines.push(`ETA: ${etaText}`);
    lines.push(`We'll notify you with any updates.`);

    const body = lines.join('\n');
    return sendSMS(customerPhone, body, restaurantNumber);
}

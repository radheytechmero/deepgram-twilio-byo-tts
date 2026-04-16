export const CONFIG = {
    API_BASE_URL: process.env.API_BASE_URL || "https://ptmq4121-5002.inc1.devtunnels.ms",
    WSS_BACKEND_BASE_URL: process.env.WSS_BACKEND_BASE_URL || "wss://ptmq4121-443.inc1.devtunnels.ms",
    PORT: parseInt(process.env.PORT || '443', 10),
    DEEPGRAM_LISTEN_PROVIDER: {
        type: 'deepgram' as const,
        version: 'v1' as const,
        model: 'nova-3' as const,
        language: 'en' as const,
    },
    DEEPGRAM_THINK_PROVIDER: {
        type: 'open_ai' as const,
        model: 'gpt-4o-mini' as const,
    },
    DEEPGRAM_SPEAK_PROVIDER: {
        type: 'deepgram' as const,
        model: 'aura-2-thalia-en' as const,
    },
    AUDIO_INPUT: {
        encoding: 'mulaw' as const,
        sampleRate: 8000,
    },
    AUDIO_OUTPUT: {
        encoding: 'mulaw' as const,
        sampleRate: 8000,
        container: 'none' as const,
    },
    KEEPALIVE_INTERVAL_MS: 5000,
    MAX_PENDING_AUDIO: 200,
    RECORDING_DELAY_MS: 2000,
};

export const humanLikeFunctions = [
    {
        "name": "end_conversation",
        "description": "End conversation naturally when customer indicates they're done (goodbye, thanks, that's all, etc.)",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Why the conversation is ending"
                }
            },
            "required": ["reason"]
        }
    },
    {
        "name": "placeOrder",
        "description": "Submit the complete order to the kitchen - make sure everything is perfect!",
        "parameters": {
            "type": "object",
            "properties": {
                "customerName": {
                    "type": "string",
                    "description": "Customer's name (only needed for new customers)"
                },
                "customerPhone": {
                    "type": "string",
                    "description": "Phone number (usually already have this)"
                },
                "customerEmail": {
                    "type": "string",
                    "description": "Email if they want receipts/updates"
                },
                "orderType": {
                    "type": "string",
                    "enum": ["dine-in", "takeaway", "delivery"],
                    "description": "How they want their food - eating here, taking out, or delivery"
                },
                "tableNumber": {
                    "type": "string",
                    "description": "Table number for dine-in orders"
                },
                "deliveryAddress": {
                    "type": "object",
                    "description": "Where to deliver (only for delivery orders)",
                    "properties": {
                        "street": { "type": "string" },
                        "city": { "type": "string" },
                        "zipCode": { "type": "string" },
                        "specialInstructions": { "type": "string", "description": "Delivery notes like 'ring doorbell', 'leave at door'" }
                    },
                    "required": ["street", "city", "zipCode"]
                },
                "orderItems": {
                    "type": "array",
                    "description": "Everything they want to eat - must include exact details from menu",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "integer",
                                "description": "Menu item ID number (from fetchMenu)"
                            },
                            "menuUID": {
                                "type": "string",
                                "description": "Menu item menuUID (from fetchMenu)"
                            },
                            "menuItemName": {
                                "type": "string",
                                "description": "Exact name from menu (from fetchMenu)"
                            },
                            "quantity": {
                                "type": "integer",
                                "minimum": 1,
                                "description": "How many they want"
                            },
                            "price": {
                                "type": "number",
                                "description": "Price per item (from fetchMenu)"
                            },
                            "size": {
                                "type": "string",
                                "enum": ["small", "medium", "large", "extra-large"],
                                "description": "Size if applicable"
                            },
                            "notes": {
                                "type": "string",
                                "description": "Any special instructions for this item"
                            }
                        },
                        "required": ["id", "menuUID", "menuItemName", "quantity", "price"]
                    }
                },
                "specialRequests": {
                    "type": "string",
                    "description": "Any special notes for the whole order"
                },
                "isConfirmed": {
                    "type": "boolean",
                    "description": "Customer has confirmed they want to place this order"
                }
            },
            "required": ["customerName", "orderItems", "isConfirmed"]
        }
    }
];
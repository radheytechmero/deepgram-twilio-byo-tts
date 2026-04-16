import axios from 'axios';
import { CONFIG } from './config';

export async function fetchMenu(callId: string): Promise<any> {
    try {
        const url = `${CONFIG.API_BASE_URL}/api/menu-items?no=${callId}`;
        console.log(`Fetching menu for call ${callId}:`, url);

        const response: any = await axios.get(url);
        const data = response.data.data;

        const modifiedData = data.map((d: any) => ({
            id: d.id,
            menuUID: d.menuUID,
            name: d.name,
            price: d.price
        }));
        return modifiedData;
    } catch (error) {
        console.error('Menu API Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: []
        };
    }
}

export async function findCustomer(phone: string | undefined, restaurantNo: string | undefined): Promise<any> {
    try {
        let url = `${CONFIG.API_BASE_URL}/api/customers?phone=${phone}&restaurantNo=${restaurantNo}`;
        console.log(`Looking up customer:`, url);

        const response: any = await axios.get(url);
        const data = response.data;

        return data || null;
    } catch (error: any) {
        console.error('Customer lookup Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: null
        };
    }
}

export async function findRestaurant(phone: string | undefined): Promise<any> {
    try {
        let url = `${CONFIG.API_BASE_URL}/api/restaurant/${phone}`;
        console.log(`Looking up restaurant:`, url);

        const response: any = await axios.get(url);
        const data = response.data;

        return data || null;
    } catch (error: any) {
        console.error('Restaurant lookup Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: null
        };
    }
}

export async function createOrder(orderData: any, restaurantNo: string): Promise<any> {
    const orderResponse = await fetch(`${CONFIG.API_BASE_URL}/api/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...orderData,
            restaurantNo
        })
    });

    return await orderResponse.json();
}
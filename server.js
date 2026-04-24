require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Load VAPID keys
let vapidKeys;
if (fs.existsSync('./vapid-keys.json')) {
    vapidKeys = JSON.parse(fs.readFileSync('./vapid-keys.json'));
} else {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync('./vapid-keys.json', JSON.stringify(vapidKeys));
}

webpush.setVapidDetails(
    'mailto:your-email@gmail.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// In-memory storage for subscriptions (replace with database for production)
let subscriptions = [];
const SUBS_FILE = './subscriptions.json';
if (fs.existsSync(SUBS_FILE)) {
    subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE));
}

function saveSubscriptions() {
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions));
}

// Subscribe endpoint
app.post('/subscribe', (req, res) => {
    const subscription = req.body;
    
    // Check if subscription already exists
    const exists = subscriptions.find(s => s.endpoint === subscription.endpoint);
    if (!exists) {
        subscriptions.push(subscription);
        saveSubscriptions();
    }
    
    res.status(201).json({ message: 'Subscribed successfully' });
});

// Order Trigger API
// Usage: POST /trigger-order-alert
// Body: { "orderId": "12345", "customerName": "John Doe", "amount": "$99.99" }
app.post('/trigger-order-alert', (req, res) => {
    const { orderId, customerName, customer, amount, total, phone, address } = req.body;
    
    // Support both your previous fields and your new payload fields
    const name = customerName || customer || 'Customer';
    const price = amount || (total ? `$${total}` : 'Price N/A');

    const notificationPayload = JSON.stringify({
        title: '📦 New Order Taken!',
        body: `Order #${orderId || 'N/A'} - ${name}\n💰 ${price}\n📞 ${phone || 'No phone'}\n📍 ${address || 'No address'}`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-96.png',
        data: {
            url: '/orders/' + (orderId || '')
        }
    });

    const promises = subscriptions.map(sub => 
        webpush.sendNotification(sub, notificationPayload).catch(error => {
            console.error('Error sending notification to endpoint:', sub.endpoint, error);
            if (error.statusCode === 404 || error.statusCode === 410) {
                return 'REMOVE';
            }
        })
    );

    Promise.all(promises).then(results => {
        // Clean up invalid subscriptions
        const beforeCount = subscriptions.length;
        subscriptions = subscriptions.filter((_, index) => results[index] !== 'REMOVE');
        if (subscriptions.length !== beforeCount) {
            saveSubscriptions();
        }
        res.status(200).json({ message: 'Notifications sent', sentTo: subscriptions.length });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Order Notification Server running on port ${PORT}`);
    console.log(`Public VAPID Key: ${vapidKeys.publicKey}`);
});

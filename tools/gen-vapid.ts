// Phase 21: Generates a single pair of VAPID keys and prints them once to stdout.
// Never writes secrets into any repository file (PHASE-21 §14 item 6).
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('Add these to your production environment / secret store (never commit them):');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);


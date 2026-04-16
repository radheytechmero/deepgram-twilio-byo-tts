import 'dotenv/config';
import { setupWebSocketServer, setupGracefulShutdown } from './server';

setupWebSocketServer();
setupGracefulShutdown();
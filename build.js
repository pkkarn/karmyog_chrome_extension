import { build, loadEnv } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

const __dirname = resolve();

// Load environment variables from .env file
const env = loadEnv('production', process.cwd(), 'VITE_');

async function run() {
  console.log('📦 Starting Karm Yog Chrome Extension build pipeline...');
  
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    console.warn('⚠️ Warning: Supabase VITE_ environment variables are not defined or loaded! Checking .env file...');
  } else {
    console.log('✅ Loaded environment variables:');
    console.log(`   URL: ${env.VITE_SUPABASE_URL}`);
    console.log(`   Key: ${env.VITE_SUPABASE_PUBLISHABLE_KEY.substring(0, 15)}...`);
  }

  // Common environment defines for all programmatically compiled bundles
  const envDefines = {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || ''),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY || ''),
    'process.env.NODE_ENV': JSON.stringify('production'),
  };

  // 1. Build Popup
  console.log('\n--- Building Popup UI ---');
  await build({
    configFile: false,
    plugins: [react()],
    define: envDefines,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'popup.html'),
        },
        output: {
          entryFileNames: '[name].js',
          assetFileNames: 'popup.[ext]',
        }
      }
    }
  });

  // 2. Build Background Script
  console.log('\n--- Building Background Service Worker ---');
  await build({
    configFile: false,
    define: envDefines,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/background/index.ts'),
        name: 'background',
        formats: ['iife'],
        fileName: () => 'background.js',
      }
    }
  });

  // 3. Build Content Script
  console.log('\n--- Building Content Script & Styles ---');
  await build({
    configFile: false,
    plugins: [react()],
    define: envDefines,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/content/index.tsx'),
        name: 'content',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: {
          assetFileNames: 'content.[ext]',
        }
      }
    }
  });

  console.log('\n✅ Karm Yog build completed successfully!');
}

run().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});

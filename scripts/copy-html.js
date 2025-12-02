const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'src', 'chatbotView.html');
const destPath = path.join(__dirname, '..', 'out', 'chatbotView.html');

try {
    // Ensure out directory exists
    const outDir = path.dirname(destPath);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    
    // Copy HTML file
    fs.copyFileSync(srcPath, destPath);
    console.log('✓ Copied chatbotView.html to out/ directory');
} catch (error) {
    console.error('✗ Failed to copy HTML file:', error.message);
    process.exit(1);
}
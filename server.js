const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// --- DIAGNOSTYKA STARTU ---
// Te logi pojawią się w czarnym oknie Rendera zaraz po starcie
console.log("=== DIAGNOSTYKA KLUCZY ===");
console.log("Klucz 1 (pierwsze 4 znaki):", process.env.GEMINI_KEY_1 ? process.env.GEMINI_KEY_1.substring(0, 4) : "BRAK!");
console.log("Klucz 2 (pierwsze 4 znaki):", process.env.GEMINI_KEY_2 ? process.env.GEMINI_KEY_2.substring(0, 4) : "BRAK!");

const apiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2
].filter(key => key && key.trim().length > 0);

if (apiKeys.length === 0) {
    console.error("❌ BŁĄD KRYTYCZNY: Nie znaleziono żadnych kluczy API w Environment!");
} else {
    console.log(`✅ Załadowano pomyślnie ${apiKeys.length} kluczy.`);
}

let currentKeyIndex = 0;

app.use(express.static('public'));

// FUNKCJA ROTACJI
async function generateWithRotation(prompt, fileData, attempt = 0) {
    if (apiKeys.length === 0) {
        throw new Error("Serwer nie posiada skonfigurowanych kluczy API.");
    }

    if (attempt >= apiKeys.length) {
        throw new Error("Oba klucze są przeciążone. Odczekaj 60 sekund i spróbuj ponownie! ⏳");
    }

    const currentKey = apiKeys[currentKeyIndex].trim(); // Trim usuwa przypadkowe spacje
    const genAI = new GoogleGenerativeAI(currentKey);
    
    // Używamy modelu 2.0 Flash z v1beta
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash", 
        apiVersion: "v1beta" 
    });

    try {
        const result = await model.generateContent([prompt, fileData]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        // Obsługa limitu 429
        if (error.status === 429 || (error.message && error.message.includes('429'))) {
            console.log(`⚠️ Klucz ${currentKeyIndex + 1} wyczerpał limit. Przełączam na zapasowy...`);
            currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
            return generateWithRotation(prompt, fileData, attempt + 1);
        }
        
        // Jeśli błąd to 404, prawdopodobnie biblioteka w package.json jest za stara
        if (error.status === 404) {
            throw new Error("Błąd 404: Model 2.0 nieosiągalny. Sprawdź wersję @google/generative-ai w package.json!");
        }
        
        throw error;
    }
}

app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie! 📸" });

        const { subject, level, mode } = req.body;
        const fileData = {
            inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype }
        };

        const prompts = {
            matematyka: "Jesteś ekspertem matematyki.",
            polski: "Jesteś polonistą.",
            fizyka: "Jesteś fizykiem.",
            inne: "Jesteś wszechstronnym nauczycielem."
        };

        let basePrompt = prompts[subject] || prompts.inne;
        let styleInstruction = (mode === 'cheat') 
            ? "TRYB ŚCIĄGANIE: Zero teorii, same obliczenia i pogrubiony wynik. Bądź ekstremalnie szybki." 
            : "TRYB NAUKA: Wyjaśnij wszystko dokładnie krok po kroku.";

        const finalPrompt = `
        ${basePrompt} Poziom: ${level}.
        ${styleInstruction}
        ZASADY: Wzory w $...$, wynik końcowy w **$...$**. Pisz po polsku.`;

        const text = await generateWithRotation(finalPrompt, fileData);
        res.json({ result: text });

    } catch (error) {
        console.error("Błąd serwera:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        if (apiKeys.length === 0) throw new Error("Brak kluczy API.");

        const genAI = new GoogleGenerativeAI(apiKeys[currentKeyIndex]);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });
        
        const prompt = `Uczeń otrzymał rozwiązanie: "${context}". Teraz pyta: "${question}". Odpowiedz krótko. Wzory w $...$.`;
        const result = await model.generateContent(prompt);
        res.json({ answer: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serwer aktywny na porcie ${PORT}. Klucze: ${apiKeys.length}`));

const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// LISTA 4 KLUCZY Z TWOICH 2 KONT (PO 2 PROJEKTY NA KONTO)
const apiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4
].filter(key => key && key.trim() !== "");

let currentKeyIndex = 0;

app.use(express.static('public'));

// GŁÓWNA FUNKCJA ROTACJI - PRÓBUJE KAŻDEGO KLUCZA PO KOLEI
async function generateWithRotation(prompt, fileData, attempt = 0) {
    if (apiKeys.length === 0) {
        throw new Error("Błąd: Nie skonfigurowałeś kluczy API w panelu Render! 🔑");
    }

    // Jeśli sprawdziliśmy już wszystkie dostępne klucze i każdy rzucił błędem
    if (attempt >= apiKeys.length) {
        throw new Error("Wszystkie darmowe limity wyczerpane. Odczekaj 60 sekund i spróbuj ponownie! ⏳");
    }

    const currentKey = apiKeys[currentKeyIndex].trim();
    const genAI = new GoogleGenerativeAI(currentKey);
    
    // Model Gemini 2.0 Flash
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash", 
        apiVersion: "v1beta" 
    });

    try {
        console.log(`[Log] Próba wykonania zadania kluczem nr ${currentKeyIndex + 1}...`);
        const result = await model.generateContent([prompt, fileData]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        // Jeśli błąd to 429 (Too Many Requests), zmień klucz
        if (error.status === 429 || (error.message && error.message.includes('429'))) {
            console.log(`⚠️ Klucz ${currentKeyIndex + 1} zajęty (Limit 429). Przełączam na następny...`);
            currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
            return generateWithRotation(prompt, fileData, attempt + 1);
        }
        
        // Inne błędy (np. błąd obrazka) wyrzucamy do konsoli
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

        // Wywołanie z rotacją
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
        
        const prompt = `Uczeń pyta: "${question}" na podstawie: "${context}". Odpowiedz krótko.`;
        const result = await model.generateContent(prompt);
        res.json({ answer: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serwer SPOFY aktywny!`);
    console.log(`Załadowano kluczy: ${apiKeys.length}`);
});

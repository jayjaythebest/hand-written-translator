import { GoogleGenAI, Type } from "@google/genai";
import { ExtractionResult } from "../types";

export async function parseExpenseImage(base64Image: string): Promise<ExtractionResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  
  const prompt = `
    Analyze this handwritten traditional Chinese expense ledger. 
    Extract the data and organize it by date.
    
    For each date found (e.g., 114年12月1日):
    1. Identify all entries under that date.
    2. For each entry, identify the person's name (姓名), the items described, and their individual costs.
    3. Calculate the total for each entry (e.g., 雨衣 198 + 電延線 2捆 1798 = 1996).
    4. Calculate the total expense for the entire day.
    
    Return the data in a structured JSON format.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image.split(",")[1] || base64Image,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          dailyExpenses: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING, description: "The date in YYYY/MM/DD or original format" },
                entries: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      items: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            description: { type: Type.STRING },
                            amount: { type: Type.NUMBER }
                          },
                          required: ["description", "amount"]
                        }
                      },
                      total: { type: Type.NUMBER }
                    },
                    required: ["name", "items", "total"]
                  }
                },
                dayTotal: { type: Type.NUMBER }
              },
              required: ["date", "entries", "dayTotal"]
            }
          }
        },
        required: ["dailyExpenses"]
      }
    },
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  
  return JSON.parse(text) as ExtractionResult;
}

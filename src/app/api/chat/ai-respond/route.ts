import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

export async function POST(request: NextRequest) {
  try {
    const { channel_id, user_message, parent_message_id } = (await request.json()) as {
      channel_id: string;
      user_message: string;
      parent_message_id: string;
    };

    const supabaseAdmin = getSupabaseAdminClient();

    const { data: recentMessages } = await supabaseAdmin
      .from("chat_messages")
      .select("content, is_ai_response, created_at")
      .eq("channel_id", channel_id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: channel } = await supabaseAdmin
      .from("chat_channels")
      .select("name, description, property_id")
      .eq("id", channel_id)
      .single();

    let propertyName = "";
    if (channel?.property_id) {
      const { data: property } = await supabaseAdmin
        .from("properties")
        .select("name")
        .eq("id", channel.property_id)
        .single();
      propertyName = property?.name || "";
    }

    const conversationHistory = (recentMessages || [])
      .reverse()
      .map((msg) => ({
        role: msg.is_ai_response ? ("assistant" as const) : ("user" as const),
        content: msg.content,
      }));

    const systemPrompt = `You are the VillageWorks AI Assistant embedded in a community chat channel.
Channel: "${channel?.name || "General"}"
Property: "${propertyName || "Cross-property"}"
Description: "${channel?.description || ""}"

You help tenants and staff with workspace, building, and community questions.
Keep responses concise and friendly.
Never share sensitive financial or personal data about other tenants.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: systemPrompt,
      messages: [...conversationHistory, { role: "user", content: user_message }],
    });

    const aiContent =
      response.content[0]?.type === "text"
        ? response.content[0].text
        : "Sorry, I could not generate a response.";

    const { error } = await supabaseAdmin.from("chat_messages").insert({
      channel_id,
      user_id: null,
      content: aiContent,
      is_ai_response: true,
      parent_message_id,
    });

    if (error) {
      console.error("Failed to insert AI response:", error);
      return NextResponse.json({ error: "Failed to save AI response" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("AI responder error:", error);
    return NextResponse.json({ error: "AI response failed" }, { status: 500 });
  }
}

use clipboard_rs::{Clipboard, ClipboardContext};
fn main() {
    let ctx = ClipboardContext::new().unwrap();
    ctx.set_text("Hello, world!".to_string()).unwrap();
    let text = ctx.get_text().unwrap();
    println!("Clipboard text: {}", text);
    ctx.clear().unwrap();
    println!("Clipboard text: {}", ctx.get_text().unwrap());

    ctx.set_files(vec![
        "/Users/hacker/Desktop/desktop-v2/package.json".to_string()
    ])
    .unwrap();
}

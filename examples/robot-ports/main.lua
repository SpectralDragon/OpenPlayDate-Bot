-- GPIO16: an LED through a resistor, or a logic input of a driver.
-- UART1: TX17/RX18, 9600 baud, 8N1. Use 3.3 V logic and common GND.
local g = opd.graphics
local on, elapsed, received = false, 0, ""
local pending = ""

local function connect()
    opd.gpio.mode(16, "output")
    opd.gpio.write(16, false)
    opd.uart.open()
    on, elapsed, pending = false, 0, ""
end

return {
    init = connect,
    resume = connect, -- Pins and UART were released on pause.

    update = function(dt)
        elapsed = elapsed + dt
        if elapsed >= 0.5 then
            elapsed = elapsed - 0.5
            on = not on
            opd.gpio.write(16, on)
        end
        if opd.input.pressed("a") and pending == "" then pending = "hello\n" end
        if #pending > 0 then
            local sent = opd.uart.write(pending) -- May send only part of the data.
            pending = pending:sub(sent + 1)
        end
        if opd.uart.available() > 0 then
            received = (received .. opd.uart.read(32)):sub(-64)
        end
        if opd.input.pressed("b") then opd.system.exit() end
    end,

    draw = function()
        g.clear(0)
        g.color(g.rgb(130, 230, 180))
        g.text("Порты робота", 14, 12, true)
        g.text(on and "GPIO16: включён" or "GPIO16: выключен", 14, 60)
        g.text("UART1: 9600 / TX17 / RX18", 14, 90)
        -- Binary UART bytes are not necessarily displayable text.
        g.text("Получено байт: " .. #received, 14, 120)
        g.text("A: отправить hello", 14, 168)
        g.text("B: выйти", 14, 196)
    end
}

local g = opd.graphics
local ball = require("ball")
local hint = opd.assets.read("assets/hint.txt")
local bright = g.rgb(255, 211, 77)
local x, y, vx, vy = 160, 100, 70, 55

return {
    update = function(dt)
        if opd.input.pressed("a") then
            vx, vy = -vx, -vy
        end
        x, y, vx, vy = ball.step(x, y, vx, vy, dt,
            opd.input.axis("x"), opd.input.axis("y"))
        if opd.input.pressed("b") then opd.system.exit() end
    end,

    draw = function()
        g.clear(g.rgb(21, 25, 29))
        g.color(bright)
        g.text("Прыгучий шарик", 14, 10, true)
        g.fillCircle(math.floor(x), math.floor(y), 10)
        g.color(g.rgb(245, 243, 233))
        g.text(hint, 14, 196)
        g.text("B: выйти", 14, 218)
    end
}

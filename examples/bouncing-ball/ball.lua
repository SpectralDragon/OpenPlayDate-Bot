local ball = {}

function ball.step(x, y, vx, vy, dt, ax, ay)
    x, y = x + (vx + ax * 120) * dt, y + (vy + ay * 120) * dt
    if x < 10 then x, vx = 10, math.abs(vx) end
    if x > 310 then x, vx = 310, -math.abs(vx) end
    if y < 48 then y, vy = 48, math.abs(vy) end
    if y > 180 then y, vy = 180, -math.abs(vy) end
    return x, y, vx, vy
end

return ball

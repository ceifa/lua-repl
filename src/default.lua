function fibonacci(n)
    local current, next = 0, 1

    for i = 1, n do
        print(current)
        current, next = next, current + next
    end

    return current
end

fibonacci(20)